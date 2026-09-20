// /api/notice/messages — 站内信 / 站内通知
// GET  ?scope=all|unread&page=     我的消息列表（含未读数）
// GET  ?view=recipients            可选接收人（staff：学生/教师清单概要）
// POST { action: 'read' | 'readAll' | 'send' | 'delete' }
//   send: staff 发送 —— { target: 'user'|'role'|'all', userId?, role?, title, content }
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { requireRoles, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { notify, notifyMany, roleUserIds, allUserIds } from '../../lib/notify.js';

export { preflight as onRequestOptions };

const PAGE_SIZE = 20;

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const url = new URL(context.request.url);
    const view = url.searchParams.get('view');
    const isStaff = roles.some((r) => ['admin', 'counselor', 'teacher'].includes(r));

    if (view === 'recipients') {
      if (!isStaff) return fail(40301, '暂无权限', 403);
      const students = await query(
        `SELECT u.id, u.real_name AS realName, u.username, u.user_no AS userNo
           FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
           JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student'
          WHERE u.status = 1 ORDER BY u.user_no LIMIT 600`,
      );
      return ok({ students });
    }

    const scope = url.searchParams.get('scope') || 'all';
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
    const where = ['m.receiver_id = ?'];
    const params = [userId];
    if (scope === 'unread') where.push('m.read_at IS NULL');

    const unread = await query(
      'SELECT COUNT(*) n FROM sys_message WHERE receiver_id = ? AND read_at IS NULL',
      [userId],
    );
    const totalRows = await query(
      `SELECT COUNT(*) n FROM sys_message m WHERE ${where.join(' AND ')}`,
      params,
    );
    const list = await query(
      `SELECT m.id, m.type, m.biz, m.title, m.content, m.read_at AS readAt, m.created_at AS createdAt,
              s.real_name AS senderName
         FROM sys_message m LEFT JOIN sys_user s ON s.id = m.sender_id
        WHERE ${where.join(' AND ')}
        ORDER BY m.id DESC
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      params,
    );
    return ok({
      list: list.map((m) => ({ ...m, unread: m.readAt === null })),
      unread: Number(unread[0].n),
      total: Number(totalRows[0].n),
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const body = await readBody(context.request);
    const action = String(body.action || '');

    if (action === 'read') {
      const id = Number(body.id);
      await query('UPDATE sys_message SET read_at = NOW() WHERE id = ? AND receiver_id = ? AND read_at IS NULL', [id, userId]);
      return ok({ id });
    }

    if (action === 'readAll') {
      await query('UPDATE sys_message SET read_at = NOW() WHERE receiver_id = ? AND read_at IS NULL', [userId]);
      return ok(null, '已全部标记已读');
    }

    if (action === 'delete') {
      const id = Number(body.id);
      await query('DELETE FROM sys_message WHERE id = ? AND receiver_id = ?', [id, userId]);
      return ok({ id }, '已删除');
    }

    if (action === 'send') {
      const isStaff = roles.some((r) => ['admin', 'counselor', 'teacher'].includes(r));
      if (!isStaff) return fail(40301, '仅教师/辅导员/管理员可发送站内信', 403);
      const title = String(body.title || '').trim().slice(0, 128);
      const content = String(body.content || '').trim().slice(0, 1024);
      const target = String(body.target || 'user');
      if (!title) return fail(49301, '请填写标题');
      if (!content) return fail(49301, '请填写正文');
      // admin 发全校广播；教师/辅导员按角色或指定用户
      if (target === 'all') {
        if (!roles.includes('admin')) return fail(40301, '仅管理员可发全校广播', 403);
        const ids = await allUserIds();
        await notifyMany(ids, title, content, { senderId: userId, type: 'user', biz: 'manual' });
        await opLog(userId, 'msg.broadcast', 'all', `${title}（${ids.length}人）`);
        return ok({ count: ids.length }, `已发送给 ${ids.length} 人`);
      }
      if (target === 'role') {
        const role = String(body.role || '');
        if (!['student', 'teacher', 'counselor', 'leader'].includes(role)) return fail(49301, '目标角色不合法');
        const ids = await roleUserIds(role);
        await notifyMany(ids, title, content, { senderId: userId, type: 'user', biz: 'manual' });
        await opLog(userId, 'msg.broadcast', `role:${role}`, `${title}（${ids.length}人）`);
        return ok({ count: ids.length }, `已发送给 ${ids.length} 人`);
      }
      // 指定用户（教师可发给自己的学生，辅导员/管理员不限）
      const receiverId = Number(body.userId);
      if (!receiverId) return fail(49301, '请选择接收人');
      await notify(receiverId, title, content, { senderId: userId, type: 'user', biz: 'manual' });
      await opLog(userId, 'msg.send', `user:${receiverId}`, title);
      return ok({ count: 1 }, '已发送');
    }

    return fail(49301, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
