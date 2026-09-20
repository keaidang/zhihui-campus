// /api/forum/threads — 论坛帖子（仅登录用户可访问，合规要求）
// GET  ?boardId=&keyword=&page=        帖子列表（置顶优先）
// GET  ?id=123                          帖子详情 + 回复列表
// POST { action: 'create' | 'reply' | 'edit' | 'delete' | 'pin' | 'lock' }
//   create: { boardId, title, content, images }   交易板块 itemName/price/contact 必填
//   reply  : { threadId, content }                锁定帖禁止回复；封禁用户禁止发帖/回复
//   edit   : { id, title?, content?, images?, itemName?, price?, contact? }  仅作者
//   delete : { id }                               作者或管理员
//   pin/lock: 管理员（论坛管理员=admin）
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

const PAGE_SIZE = 20;

async function ensureNotBanned(userId) {
  const rows = await query('SELECT reason FROM forum_ban WHERE user_id = ?', [userId]);
  if (rows.length > 0) throw ERR_FORBIDDEN(`你已被论坛管理员禁言（原因：${rows[0].reason || '违规'}）`);
}

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const url = new URL(context.request.url);
    const isAdmin = roles.includes('admin');

    // 详情 + 回复
    const id = url.searchParams.get('id');
    if (id) {
      const tid = Number(id);
      const threads = await query(
        `SELECT t.id, t.board_id AS boardId, t.author_id AS authorId, t.title, t.content, t.images,
                t.is_trade AS isTrade, t.item_name AS itemName, t.price, t.contact,
                t.pinned, t.locked, t.status, t.reply_count AS replyCount, t.created_at AS createdAt,
                b.name AS boardName, u.real_name AS authorName, u.username
           FROM forum_thread t
           JOIN forum_board b ON b.id = t.board_id
           JOIN sys_user u ON u.id = t.author_id
          WHERE t.id = ?`,
        [tid],
      );
      if (threads.length === 0 || Number(threads[0].status) !== 1) return fail(49004, '帖子不存在或已被删除', 404);
      const t = threads[0];
      let imgs = [];
      try {
        imgs = JSON.parse(t.images || '[]');
      } catch {
        imgs = [];
      }
      const replies = await query(
        `SELECT r.id, r.content, r.created_at AS createdAt, r.author_id AS authorId,
                u.real_name AS authorName, u.username
           FROM forum_reply r
           JOIN sys_user u ON u.id = r.author_id
          WHERE r.thread_id = ? AND r.status = 1
          ORDER BY r.id ASC
          LIMIT 200`,
        [tid],
      );
      return ok({
        thread: { ...t, images: imgs, canEdit: Number(t.authorId) === userId, canModerate: isAdmin },
        replies,
        viewerId: userId,
      });
    }

    // 列表
    const boardId = Number(url.searchParams.get('boardId')) || 0;
    const keyword = String(url.searchParams.get('keyword') || '').trim().slice(0, 32);
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const scope = url.searchParams.get('scope') || '';
    const where = ['t.status = 1'];
    const params = [];
    if (boardId) {
      where.push('t.board_id = ?');
      params.push(boardId);
    }
    if (keyword) {
      where.push('(t.title LIKE ? OR t.content LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like);
    }
    if (scope === 'mine') {
      where.push('t.author_id = ?');
      params.push(userId);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');
    const total = await query(`SELECT COUNT(*) n FROM forum_thread t ${whereSql}`, params);
    const rows = await query(
      `SELECT t.id, t.board_id AS boardId, t.title, t.is_trade AS isTrade, t.item_name AS itemName,
              t.price, t.contact, t.pinned, t.locked, t.reply_count AS replyCount, t.created_at AS createdAt,
              t.last_reply_at AS lastReplyAt,
              b.name AS boardName, u.real_name AS authorName, u.username,
              (SELECT r.content FROM forum_reply r WHERE r.thread_id = t.id AND r.status = 1 ORDER BY r.id DESC LIMIT 1) AS lastReply
         FROM forum_thread t
         JOIN forum_board b ON b.id = t.board_id
         JOIN sys_user u ON u.id = t.author_id
        ${whereSql}
        ORDER BY t.pinned DESC, t.last_reply_at DESC, t.id DESC
        LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );
    return ok({ list: rows, total: Number(total[0].n), page, pageSize: PAGE_SIZE, isAdmin });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const ip = clientIp(context.request);
    const body = await readBody(context.request, 128 * 1024);
    const action = String(body.action || '');
    const isAdmin = roles.includes('admin');

    if (action === 'create') {
      await ensureNotBanned(userId);
      const boardId = Number(body.boardId);
      const title = String(body.title || '').trim().slice(0, 128);
      const content = String(body.content || '').trim().slice(0, 20000);
      const boards = await query('SELECT id, name, is_trade FROM forum_board WHERE id = ? AND status = 1', [boardId]);
      if (boards.length === 0) return fail(49001, '板块不存在');
      const board = boards[0];
      if (!title) return fail(49001, '请填写标题');
      if (content.length < 2) return fail(49001, '正文太短');

      let itemName = '';
      let price = null;
      let contact = '';
      if (Number(board.is_trade) === 1) {
        itemName = String(body.itemName ?? '').trim().slice(0, 64);
        contact = String(body.contact ?? '').trim().slice(0, 64);
        // 统一归一化：缺失/null/空串 → null（必填校验拦截），避免 NaN/缺键走不同分支
        price = body.price === undefined || body.price === null || body.price === '' ? null : Number(body.price);
        if (!itemName) return fail(49001, '交易帖必须填写物品信息');
        if (price === null || !Number.isFinite(price) || price < 0) return fail(49001, '交易帖必须填写有效价格');
        if (!contact) return fail(49001, '交易帖必须填写联系方式');
      }

      let images = [];
      if (Array.isArray(body.images)) {
        images = body.images
          .map((u) => String(u).trim())
          .filter((u) => /^\/api\/blob\?token=[a-z0-9]{16}$/.test(u) || /^https?:\/\//.test(u))
          .slice(0, 9);
      }

      const r = await query(
        `INSERT INTO forum_thread (board_id, author_id, title, content, images, is_trade, item_name, price, contact)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [boardId, userId, title, content, JSON.stringify(images), Number(board.is_trade), itemName, price, contact],
      );
      return ok({ id: r.insertId }, '发布成功');
    }

    if (action === 'reply') {
      await ensureNotBanned(userId);
      const threadId = Number(body.threadId);
      const content = String(body.content || '').trim().slice(0, 1024);
      if (content.length < 1) return fail(49001, '回复内容不能为空');
      const threads = await query('SELECT id, locked, status FROM forum_thread WHERE id = ?', [threadId]);
      if (threads.length === 0 || Number(threads[0].status) !== 1) return fail(49004, '帖子不存在或已被删除');
      if (Number(threads[0].locked) === 1 && !isAdmin) return fail(49005, '该帖已被锁定，禁止回复');
      const r = await query('INSERT INTO forum_reply (thread_id, author_id, content) VALUES (?, ?, ?)', [threadId, userId, content]);
      await query('UPDATE forum_thread SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = ?', [threadId]);
      return ok({ id: r.insertId }, '回复成功');
    }

    if (action === 'edit') {
      const id = Number(body.id);
      const rows = await query('SELECT id, author_id, is_trade FROM forum_thread WHERE id = ?', [id]);
      if (rows.length === 0) return fail(49004, '帖子不存在');
      if (Number(rows[0].author_id) !== userId && !isAdmin) throw ERR_FORBIDDEN('只能编辑自己的帖子');
      const title = String(body.title || '').trim().slice(0, 128);
      const content = String(body.content || '').trim().slice(0, 20000);
      if (!title || content.length < 2) return fail(49001, '标题或正文无效');
      const itemName = String(body.itemName ?? '').trim().slice(0, 64);
      const contact = String(body.contact ?? '').trim().slice(0, 64);
      const priceRaw = body.price;
      const price = priceRaw === undefined || priceRaw === null || priceRaw === '' ? null : Number(priceRaw);
      if (Number(rows[0].is_trade) === 1 && (!itemName || price === null || !Number.isFinite(price) || !contact)) {
        return fail(49001, '交易帖的物品信息、价格、联系方式必填');
      }
      let images = null;
      if (Array.isArray(body.images)) {
        images = JSON.stringify(
          body.images.map((u) => String(u).trim()).filter((u) => /^\/api\/blob\?token=[a-z0-9]{16}$/.test(u) || /^https?:\/\//.test(u)).slice(0, 9),
        );
      }
      await query(
        `UPDATE forum_thread SET title = ?, content = ?${images ? ', images = ?' : ''}${
          Number(rows[0].is_trade) === 1 ? ', item_name = ?, price = ?, contact = ?' : ''
        } WHERE id = ?`,
        [
          title,
          content,
          ...(images ? [images] : []),
          ...(Number(rows[0].is_trade) === 1 ? [itemName, price, contact] : []),
          id,
        ],
      );
      return ok({ id }, '帖子已更新');
    }

    if (action === 'delete') {
      const id = Number(body.id);
      const rows = await query('SELECT id, author_id FROM forum_thread WHERE id = ?', [id]);
      if (rows.length === 0) return fail(49004, '帖子不存在');
      if (Number(rows[0].author_id) !== userId && !isAdmin) throw ERR_FORBIDDEN('只能删除自己的帖子');
      await query('UPDATE forum_thread SET status = 0 WHERE id = ?', [id]);
      await opLog(userId, 'forum.delete', `thread:${id}`, '', ip);
      return ok({ id }, '帖子已删除');
    }

    if (action === 'pin' || action === 'lock') {
      if (!isAdmin) throw ERR_FORBIDDEN('仅论坛管理员可执行该操作');
      const id = Number(body.id);
      const on = Boolean(body.on);
      const rows = await query('SELECT id FROM forum_thread WHERE id = ?', [id]);
      if (rows.length === 0) return fail(49004, '帖子不存在');
      await query(`UPDATE forum_thread SET ${action === 'pin' ? 'pinned' : 'locked'} = ? WHERE id = ?`, [on ? 1 : 0, id]);
      await opLog(userId, `forum.${action}`, `thread:${id}`, on ? 'on' : 'off', ip);
      return ok({ id, on }, action === 'pin' ? (on ? '已置顶' : '已取消置顶') : on ? '已锁定' : '已解锁');
    }

    return fail(49001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
