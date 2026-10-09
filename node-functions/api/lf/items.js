// /api/lf/items — 失物招领
// GET  列表（全员登录可见；?status=0 只看已下架仅发布者/管理员）
// POST { action: 'create' | 'close', ... }
//   create：学工处（counselor）/admin 发布，{ title, description, images: [url], contact }
//   close ：发布人/管理员下架（已认领）
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { notify } from '../../lib/notify.js';
import { findSimilarItems } from '../../lib/ai-lf-match.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const url = new URL(context.request.url);
    const keyword = String(url.searchParams.get('keyword') || '').trim().slice(0, 32);
    const isStaff = roles.some((r) => ['admin', 'counselor'].includes(r));

    const where = [];
    const params = [];
    if (isStaff && url.searchParams.get('scope') === 'mine') {
      where.push('i.publisher_id = ?');
      params.push(userId);
    } else {
      where.push('i.status = 1');
    }
    if (keyword) {
      where.push('(i.title LIKE ? OR i.description LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like);
    }
    const rows = await query(
      `SELECT i.id, i.title, i.description, i.images, i.contact, i.status, i.created_at AS createdAt,
              u.real_name AS publisherName
         FROM lf_item i
         JOIN sys_user u ON u.id = i.publisher_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY i.id DESC
        LIMIT 100`,
      params,
    );
    // 图片 JSON 解析失败兜底为空数组
    const list = rows.map((r) => {
      let imgs = [];
      try {
        imgs = JSON.parse(r.images || '[]');
      } catch {
        imgs = [];
      }
      return { ...r, images: imgs };
    });
    return ok({ list, canPublish: isStaff });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const ip = clientIp(context.request);
    const body = await readBody(context.request, 64 * 1024);
    const action = String(body.action || '');

    if (action === 'create') {
      if (!roles.some((r) => ['admin', 'counselor'].includes(r))) {
        throw ERR_FORBIDDEN('失物招领由学工处统一发布，请联系学工处');
      }
      const title = String(body.title || '').trim().slice(0, 64);
      const description = String(body.description || '').trim().slice(0, 512);
      const contact = String(body.contact || '').trim().slice(0, 32);
      let images = [];
      if (Array.isArray(body.images)) {
        images = body.images
          .map((u) => String(u).trim())
          .filter((u) => /^\/api\/blob\?token=[a-z0-9]{16}$/.test(u) || /^https?:\/\//.test(u))
          .slice(0, 6);
      }
      if (!title) return fail(45001, '请填写物品名称');
      if (!description) return fail(45001, '请填写物品描述（拾获地点、特征等）');
      if (!contact) return fail(45001, '请填写联系电话');
      if (description.length < 5) return fail(45001, '描述太短，请补充拾获地点或特征');

      const r = await query(
        'INSERT INTO lf_item (title, description, images, contact, publisher_id) VALUES (?, ?, ?, ?, ?)',
        [title, description, JSON.stringify(images), contact, userId],
      );
      await opLog(userId, 'lf.create', `lf:${r.insertId}`, title, ip);

      // C10 智能匹配：与已有条目比对，命中则**双向**提示（开关关闭时该函数立刻返回 []）
      // ★ 用 catch 兜底：匹配失败绝不能让"发布"失败
      const matches = await findSimilarItems({
        title,
        description,
        excludeId: r.insertId,
        userId,
      }).catch(() => []);

      if (matches.length) {
        const top = matches[0];
        await notify(
          userId,
          '可能与已有失物招领重复',
          `你刚发布的「${title}」与已有条目「${top.title}」（相似度 ${Math.round(top.score * 100)}%，${top.reason}）可能是同一物品。若确为同一件，可在列表中下架本条，避免重复。`,
          { senderId: userId, biz: 'lf' },
        );
        // 双向：也提醒原条目发布者（可能是同一位学工处老师，站内信会自动去重展示）
        if (top.publisherId && top.publisherId !== userId) {
          await notify(
            top.publisherId,
            '失物招领可能有新线索',
            `新发布的「${title}」与你的条目「${top.title}」相似（${Math.round(top.score * 100)}%，${top.reason}），可能为同一物品，建议核对。`,
            { senderId: userId, biz: 'lf' },
          );
        }
        await opLog(userId, 'lf.match', `lf:${r.insertId}`, `matched=${matches.map((m) => m.id).join(',')}`, ip);
      }

      return ok({ id: r.insertId, matches }, matches.length ? `已发布。发现 ${matches.length} 条相似条目，请到列表中核对。` : '失物招领已发布');
    }

    if (action === 'close') {
      const id = Number(body.id);
      const rows = await query('SELECT id, publisher_id, title, status FROM lf_item WHERE id = ?', [id]);
      if (rows.length === 0) return fail(45004, '记录不存在');
      const item = rows[0];
      if (Number(item.publisher_id) !== userId && !roles.includes('admin')) {
        throw ERR_FORBIDDEN('仅发布人/管理员可下架');
      }
      if (Number(item.status) !== 1) return fail(45005, '该记录已下架');
      await query('UPDATE lf_item SET status = 0 WHERE id = ?', [id]);
      await opLog(userId, 'lf.close', `lf:${id}`, item.title, ip);
      return ok({ id }, '已下架（物品已被认领）');
    }

    return fail(45001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
