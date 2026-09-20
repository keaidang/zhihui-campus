// /api/forum/moderate — 论坛用户权限管理（论坛管理员=admin）
// GET       被封禁用户列表
// POST { action: 'ban' | 'unban', userId, reason? }
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const { roles } = await requireRoles(context, ['admin']);
    const rows = await query(
      `SELECT b.user_id AS userId, b.reason, b.banned_at AS bannedAt,
              u.real_name AS userName, u.username
         FROM forum_ban b
         JOIN sys_user u ON u.id = b.user_id
        ORDER BY b.banned_at DESC
        LIMIT 100`,
    );
    return ok({ list: rows, canModerate: roles.includes('admin') });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId: operatorId } = await requireRoles(context, ['admin']);
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || '');
    const targetId = Number(body.userId);

    if (action === 'ban') {
      const reason = String(body.reason || '违规发言').trim().slice(0, 128);
      if (!targetId || targetId === operatorId) return fail(49101, '无效的封禁对象');
      const users = await query('SELECT id, username FROM sys_user WHERE id = ?', [targetId]);
      if (users.length === 0) return fail(49102, '用户不存在');
      await query(
        `INSERT INTO forum_ban (user_id, reason, banned_by) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reason = VALUES(reason), banned_by = VALUES(banned_by), banned_at = NOW()`,
        [targetId, reason, operatorId],
      );
      await opLog(operatorId, 'forum.ban', `user:${targetId}`, reason, ip);
      return ok({ userId: targetId }, `已禁言 ${users[0].username}`);
    }

    if (action === 'unban') {
      if (!targetId) return fail(49101, '无效的用户');
      await query('DELETE FROM forum_ban WHERE user_id = ?', [targetId]);
      await opLog(operatorId, 'forum.unban', `user:${targetId}`, '', ip);
      return ok({ userId: targetId }, '已解除禁言');
    }

    if (action !== '') throw ERR_FORBIDDEN();
    return fail(49101, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
