// /api/me/mail-password — 用户自助修改校园邮箱密码（需已开通对外收发）
// POST {newPassword}
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { resetMailboxPassword } from '../../lib/lanqin.js';

export { preflight as onRequestOptions };

export async function onRequestPost(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 8 || newPassword.length > 64) return fail(43300, '密码长度须为 8~64 位');

    const [users] = await query(
      'SELECT id, campus_email, mail_enabled, mail_mailbox_id FROM sys_user WHERE id = ?',
      [userId],
    );
    if (!users.length) return fail(43300, '用户不存在');
    const u = users[0];
    if (!u.mail_enabled || !u.mail_mailbox_id) return fail(43301, '尚未开通邮箱对外收发，无法修改密码');

    const r = await resetMailboxPassword(u.mail_mailbox_id, newPassword);
    if (!r.ok) return fail(43302, `密码修改失败：${r.error}`);
    await query('UPDATE sys_user SET mail_password = ? WHERE id = ?', [newPassword, userId]);
    await opLog(userId, 'mailbox.userPassword', `user:${userId}`, roles.join('|'), ip);
    return ok(null, '邮箱密码已修改，下次登录邮件系统请使用新密码');
  } catch (e) {
    return jsonError(e);
  }
}
