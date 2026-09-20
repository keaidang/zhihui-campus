// /api/auth/password/forgot-reset — 忘记密码：验证码校验 + 重置密码
// POST { username, email, code, newPassword }
// 重置成功后吊销该用户全部刷新令牌（已登录会话全部失效，需重新登录）
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../../lib/http.js';
import { query } from '../../../lib/db.js';
import { opLog } from '../../../lib/guard.js';
import { edgeBlacklist } from '../../../lib/edgegw.js';
import bcrypt from 'bcryptjs';

export { preflight as onRequestOptions };

const PWD_OK = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 64;

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const username = String(body.username || '').trim().slice(0, 32);
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim();
    const newPassword = String(body.newPassword || '');
    const ip = clientIp(context.request);
    if (!username || !email) return fail(43501, '请输入账号与绑定邮箱');
    if (!/^\d{6}$/.test(code)) return fail(43501, '请输入 6 位验证码');
    if (!PWD_OK(newPassword)) return fail(43507, '新密码至少 8 位');

    const users = await query('SELECT id, status FROM sys_user WHERE username = ? AND email = ?', [username, email]);
    if (users.length === 0) return fail(43502, '账号与绑定邮箱不匹配');
    const user = users[0];
    if (Number(user.status) !== 1) return fail(43503, '该账号已被停用');

    const rows = await query(
      `SELECT id, code, attempts, expires_at, (expires_at < NOW()) AS expired FROM sys_email_code
        WHERE email = ? AND purpose = 'reset' AND used = 0
        ORDER BY id DESC LIMIT 1`,
      [email],
    );
    if (rows.length === 0) return fail(43508, '请先获取验证码');
    const rec = rows[0];
    if (Number(rec.attempts) >= 5) return fail(43508, '验证码错误次数过多，请重新获取');
    if (Number(rec.expired) === 1) return fail(43508, '验证码已过期，请重新获取');
    if (String(rec.code) !== code) {
      await query('UPDATE sys_email_code SET attempts = attempts + 1 WHERE id = ?', [rec.id]);
      const left = 5 - Number(rec.attempts) - 1;
      return fail(43508, `验证码不正确（剩余 ${Math.max(0, left)} 次机会）`);
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE sys_email_code SET used = 1 WHERE id = ?', [rec.id]);
    await query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [hash, user.id]);
    // 吊销全部刷新令牌：旧会话立即失效
    try {
      await query('DELETE FROM sys_refresh_token WHERE user_id = ?', [user.id]);
    } catch {
      /* 表可能无该用户记录，忽略 */
    }
    // 用户级访问令牌吊销（边缘黑名单）：重置前签发的在途令牌全部失效
    await edgeBlacklist(context.request, { userId: user.id });
    await opLog(user.id, 'password.forgotReset', `user:${user.id}`, '通过邮箱验证码自助重置密码', ip);
    return ok({ reset: true }, '密码已重置，请使用新密码登录');
  } catch (e) {
    return jsonError(e);
  }
}
