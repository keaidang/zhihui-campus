// lib/services/forum.js — 论坛帖子服务（从 api/forum/threads.js 抽出）
//
// 调用方：api/forum/threads.js（人工） + P5 的 lib/ai-review.js（发帖前审核钩子）
//
// ★ 审核钩子（onBeforeInsert）：P5「论坛 AI 审核员」需要"校验通过、入库之前"这个时机。
//   把它做成钩子而不是写死在这里，是为了让服务层保持**不依赖 AI**：
//   AI 未开启时传 undefined，行为与改造前完全一致（零额外开销）。
import { HttpError, opLog } from '../guard.js';
import { query } from '../db.js';
import { auditDetail, isAdmin } from './_actor.js';

const PAGE_SIZE = 20;
const REVIEW_STATUS = { NORMAL: 0, PENDING: 1, VIOLATION: 2 };

/** 封禁校验：被禁言用户不能发帖/回复 */
export async function ensureNotBanned(userId) {
  const rows = await query('SELECT reason FROM forum_ban WHERE user_id = ?', [userId]);
  if (rows.length > 0) throw new HttpError(40301, `你已被论坛管理员禁言（原因：${rows[0].reason || '违规'}）`, 403);
}

/** 帖子详情 + 回复列表 */
export async function getThread(actor, id) {
  const tid = Number(id);
  const threads = await query(
    `SELECT t.id, t.board_id AS boardId, t.author_id AS authorId, t.title, t.content, t.images,
            t.is_trade AS isTrade, t.item_name AS itemName, t.price, t.contact,
            t.pinned, t.locked, t.status, t.review_status AS reviewStatus,
            t.reply_count AS replyCount, t.created_at AS createdAt,
            b.name AS boardName, u.real_name AS authorName, u.username
       FROM forum_thread t
       JOIN forum_board b ON b.id = t.board_id
       JOIN sys_user u ON u.id = t.author_id
      WHERE t.id = ?`,
    [tid],
  );
  if (threads.length === 0 || Number(threads[0].status) !== 1) throw new HttpError(49004, '帖子不存在或已被删除', 404);
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
  return {
    data: {
      thread: { ...t, images: imgs, canEdit: Number(t.authorId) === actor.userId, canModerate: isAdmin(actor) },
      replies,
      viewerId: actor.userId,
    },
    message: 'ok',
  };
}

/** 帖子列表（置顶优先） */
export async function listThreads(actor, { boardId = 0, keyword = '', page = 1, scope = '' } = {}) {
  const bid = Number(boardId) || 0;
  const kw = String(keyword).trim().slice(0, 32);
  const p = Math.max(1, Number(page) || 1);
  const where = ['t.status = 1'];
  const params = [];
  if (bid) {
    where.push('t.board_id = ?');
    params.push(bid);
  }
  if (kw) {
    where.push('(t.title LIKE ? OR t.content LIKE ?)');
    const like = `%${kw}%`;
    params.push(like, like);
  }
  if (scope === 'mine') {
    where.push('t.author_id = ?');
    params.push(actor.userId);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = await query(`SELECT COUNT(*) n FROM forum_thread t ${whereSql}`, params);
  const rows = await query(
    `SELECT t.id, t.board_id AS boardId, t.title, t.is_trade AS isTrade, t.item_name AS itemName,
            t.price, t.contact, t.pinned, t.locked, t.review_status AS reviewStatus,
            t.reply_count AS replyCount, t.created_at AS createdAt,
            t.last_reply_at AS lastReplyAt,
            b.name AS boardName, u.real_name AS authorName, u.username,
            (SELECT r.content FROM forum_reply r WHERE r.thread_id = t.id AND r.status = 1 ORDER BY r.id DESC LIMIT 1) AS lastReply
       FROM forum_thread t
       JOIN forum_board b ON b.id = t.board_id
       JOIN sys_user u ON u.id = t.author_id
      ${whereSql}
      ORDER BY t.pinned DESC, t.last_reply_at DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (p - 1) * PAGE_SIZE],
  );
  return { data: { list: rows, total: Number(total[0].n), page: p, pageSize: PAGE_SIZE, isAdmin: isAdmin(actor) }, message: 'ok' };
}

/** 清洗图片数组（只允许本站 blob token 或 http(s) 外链，最多 9 张） */
function cleanImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((u) => String(u).trim())
    .filter((u) => /^\/api\/blob\?token=[a-z0-9]{16}$/.test(u) || /^https?:\/\//.test(u))
    .slice(0, 9);
}

/**
 * 发帖
 * @param {object} [hooks]
 * @param {(payload:{title:string, content:string, board:object}) => Promise<{block?:boolean, message?:string, reviewStatus?:number}>} [hooks.onBeforeInsert]
 *        审核钩子（P5 用它接 AI 审核）。返回 `block:true` 则拒绝发帖；`reviewStatus` 落库标记待复核。
 */
export async function createThread(actor, body = {}, { onBeforeInsert } = {}) {
  await ensureNotBanned(actor.userId);
  const boardId = Number(body.boardId);
  const title = String(body.title || '').trim().slice(0, 128);
  const content = String(body.content || '').trim().slice(0, 20000);
  const boards = await query('SELECT id, name, is_trade FROM forum_board WHERE id = ? AND status = 1', [boardId]);
  if (boards.length === 0) throw new HttpError(49001, '板块不存在');
  const board = boards[0];
  if (!title) throw new HttpError(49001, '请填写标题');
  if (content.length < 2) throw new HttpError(49001, '正文太短');

  let itemName = '';
  let price = null;
  let contact = '';
  if (Number(board.is_trade) === 1) {
    itemName = String(body.itemName ?? '').trim().slice(0, 64);
    contact = String(body.contact ?? '').trim().slice(0, 64);
    // 统一归一化：缺失/null/空串 → null（必填校验拦截），避免 NaN/缺键走不同分支
    price = body.price === undefined || body.price === null || body.price === '' ? null : Number(body.price);
    if (!itemName) throw new HttpError(49001, '交易帖必须填写物品信息');
    if (price === null || !Number.isFinite(price) || price < 0) throw new HttpError(49001, '交易帖必须填写有效价格');
    if (!contact) throw new HttpError(49001, '交易帖必须填写联系方式');
  }

  const images = cleanImages(body.images);

  // ---- 审核钩子（AI 审核员；未开启时 h 为 undefined，行为与改造前一致）----
  let reviewStatus = REVIEW_STATUS.NORMAL;
  if (onBeforeInsert) {
    const h = await onBeforeInsert({ title, content, board, userId: actor.userId });
    if (h?.block) throw new HttpError(49006, h.message || '内容未通过审核，请修改后重试');
    if (Number.isInteger(h?.reviewStatus)) reviewStatus = h.reviewStatus;
  }

  const r = await query(
    `INSERT INTO forum_thread (board_id, author_id, title, content, images, is_trade, item_name, price, contact, review_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [boardId, actor.userId, title, content, JSON.stringify(images), Number(board.is_trade), itemName, price, contact, reviewStatus],
  );
  return { data: { id: r.insertId, reviewStatus }, message: '发布成功' };
}

/**
 * 回复
 * @param {object} [hooks] 同 createThread（回复也会被审核）
 */
export async function replyThread(actor, body = {}, { onBeforeInsert } = {}) {
  await ensureNotBanned(actor.userId);
  const threadId = Number(body.threadId);
  const content = String(body.content || '').trim().slice(0, 1024);
  if (content.length < 1) throw new HttpError(49001, '回复内容不能为空');
  const threads = await query('SELECT id, locked, status, title FROM forum_thread WHERE id = ?', [threadId]);
  if (threads.length === 0 || Number(threads[0].status) !== 1) throw new HttpError(49004, '帖子不存在或已被删除');
  if (Number(threads[0].locked) === 1 && !isAdmin(actor)) throw new HttpError(49005, '该帖已被锁定，禁止回复');

  let reviewStatus = REVIEW_STATUS.NORMAL;
  if (onBeforeInsert) {
    const h = await onBeforeInsert({ title: threads[0].title, content, userId: actor.userId });
    if (h?.block) throw new HttpError(49006, h.message || '内容未通过审核，请修改后重试');
    if (Number.isInteger(h?.reviewStatus)) reviewStatus = h.reviewStatus;
  }

  const r = await query('INSERT INTO forum_reply (thread_id, author_id, content, review_status) VALUES (?, ?, ?, ?)', [
    threadId,
    actor.userId,
    content,
    reviewStatus,
  ]);
  await query('UPDATE forum_thread SET reply_count = reply_count + 1, last_reply_at = NOW() WHERE id = ?', [threadId]);
  return { data: { id: r.insertId, reviewStatus }, message: '回复成功' };
}

/** 编辑帖子（作者本人或管理员） */
export async function editThread(actor, body = {}) {
  const id = Number(body.id);
  const rows = await query('SELECT id, author_id, is_trade FROM forum_thread WHERE id = ?', [id]);
  if (rows.length === 0) throw new HttpError(49004, '帖子不存在');
  if (Number(rows[0].author_id) !== actor.userId && !isAdmin(actor)) throw new HttpError(40301, '只能编辑自己的帖子', 403);

  const title = String(body.title || '').trim().slice(0, 128);
  const content = String(body.content || '').trim().slice(0, 20000);
  if (!title || content.length < 2) throw new HttpError(49001, '标题或正文无效');
  const itemName = String(body.itemName ?? '').trim().slice(0, 64);
  const contact = String(body.contact ?? '').trim().slice(0, 64);
  const priceRaw = body.price;
  const price = priceRaw === undefined || priceRaw === null || priceRaw === '' ? null : Number(priceRaw);
  const isTrade = Number(rows[0].is_trade) === 1;
  if (isTrade && (!itemName || price === null || !Number.isFinite(price) || !contact)) {
    throw new HttpError(49001, '交易帖的物品信息、价格、联系方式必填');
  }
  const images = Array.isArray(body.images) ? JSON.stringify(cleanImages(body.images)) : null;

  await query(
    `UPDATE forum_thread SET title = ?, content = ?${images ? ', images = ?' : ''}${isTrade ? ', item_name = ?, price = ?, contact = ?' : ''} WHERE id = ?`,
    [title, content, ...(images ? [images] : []), ...(isTrade ? [itemName, price, contact] : []), id],
  );
  return { data: { id }, message: '帖子已更新' };
}

/** 删除帖子（软删：status=0；作者本人或管理员） */
export async function deleteThread(actor, id) {
  const tid = Number(id);
  const rows = await query('SELECT id, author_id FROM forum_thread WHERE id = ?', [tid]);
  if (rows.length === 0) throw new HttpError(49004, '帖子不存在');
  if (Number(rows[0].author_id) !== actor.userId && !isAdmin(actor)) throw new HttpError(40301, '只能删除自己的帖子', 403);
  await query('UPDATE forum_thread SET status = 0 WHERE id = ?', [tid]);
  await opLog(actor.userId, 'forum.delete', `thread:${tid}`, auditDetail(actor, ''), actor.ip);
  return { data: { id: tid }, message: '帖子已删除' };
}

/** 置顶 / 锁定（仅论坛管理员=admin） */
export async function moderateThread(actor, { id, action, on }) {
  if (!isAdmin(actor)) throw new HttpError(40301, '仅论坛管理员可执行该操作', 403);
  const tid = Number(id);
  const rows = await query('SELECT id FROM forum_thread WHERE id = ?', [tid]);
  if (rows.length === 0) throw new HttpError(49004, '帖子不存在');
  const col = action === 'pin' ? 'pinned' : 'locked';
  await query(`UPDATE forum_thread SET ${col} = ? WHERE id = ?`, [on ? 1 : 0, tid]);
  await opLog(actor.userId, `forum.${action}`, `thread:${tid}`, auditDetail(actor, on ? 'on' : 'off'), actor.ip);
  return {
    data: { id: tid, on: Boolean(on) },
    message: action === 'pin' ? (on ? '已置顶' : '已取消置顶') : on ? '已锁定' : '已解锁',
  };
}

/** 动作分发（handler 薄壳用） */
export async function handleThreadAction(actor, body = {}, hooks = {}) {
  const action = String(body.action || '');
  if (action === 'create') return createThread(actor, body, hooks);
  if (action === 'reply') return replyThread(actor, body, hooks);
  if (action === 'edit') return editThread(actor, body);
  if (action === 'delete') return deleteThread(actor, body.id);
  if (action === 'pin' || action === 'lock') {
    return moderateThread(actor, { id: body.id, action, on: Boolean(body.on) });
  }
  throw new HttpError(49001, '不支持的操作');
}

export { REVIEW_STATUS };
