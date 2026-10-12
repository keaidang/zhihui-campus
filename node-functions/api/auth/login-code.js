// /api/auth/login-code — 邮箱免密登录：验证码校验与令牌签发
// POST { email, code } → 校验验证码 + 签发 JWT 双令牌 + 记录登录日志
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { query } from '../../lib/db.js';
import { signAccessToken, newRefreshToken, saveRefreshToken } from '../../lib/auth.js';
import { buildSessionUser } from '../../lib/user-profile.js';

export { preflight as onRequestOptions };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim();
    const ip = clientIp(context.request);
    const ua = (context.request.headers.get('user-agent') || '').slice(0, 255);

    if (!email || !code) return fail(41001, '请输入邮箱和验证码');
    if (!EMAIL_RE.test(email)) return fail(41002, '邮箱格式不正确');
    if (!/^\d{6}$/.test(code)) return fail(41003, '请输入 6 位数字验证码');

    // 校验验证码（查找 purpose='login' 且未使用的最新一条记录）
    const rows = await query(
      `SELECT id, code, attempts, expires_at, (expires_at < NOW()) AS expired
         FROM sys_email_code
        WHERE email = ? AND purpose = 'login' AND used = 0
        ORDER BY id DESC LIMIT 1`,
      [email],
    );

    if (rows.length === 0) return fail(40102, '请先获取验证码');
    const rec = rows[0];
    if (Number(rec.attempts) >= 5) return fail(40103, '验证码错误次数过多，请重新获取');
    if (Number(rec.expired) === 1) return fail(40104, '验证码已过期，请重新获取');

    if (String(rec.code) !== code) {
      await query('UPDATE sys_email_code SET attempts = attempts + 1 WHERE id = ?', [rec.id]);
      const left = 5 - Number(rec.attempts) - 1;
      return fail(40105, `验证码不正确（剩余 ${Math.max(0, left)} 次尝试机会）`);
    }

    // 验证码通过，标记已使用
    await query('UPDATE sys_email_code SET used = 1 WHERE id = ?', [rec.id]);

    // 查找对应绑定的用户
    const users = await query(
      'SELECT id, username, real_name, status, valid_until FROM sys_user WHERE email = ? LIMIT 1',
      [email],
    );
    if (users.length === 0) return fail(40401, '未找到该邮箱绑定的有效账号');
    const user = users[0];

    if (Number(user.status) !== 1) return fail(40300, '账号已被停用，请联系管理员');
    if (user.valid_until && new Date(user.valid_until).getTime() < Date.now()) {
      return fail(40300, '账号已过有效期，请联系管理员续期');
    }

    // 字段组装统一走 lib/user-profile.js（与 /auth/login、/auth/me、/auth/refresh 同源），
    // 顺带省掉前端免密登录后再补发一次 GET /api/auth/me 的串行往返
    const profile = await buildSessionUser(user.id);
    if (!profile) return fail(40401, '未找到该邮箱绑定的有效账号');

    const accessToken = signAccessToken(profile.user, profile.roles);
    const refreshToken = newRefreshToken();
    await saveRefreshToken(user.id, refreshToken);
    await query('UPDATE sys_user SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await query(
      'INSERT INTO sys_login_log (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, 1)',
      [user.id, user.username, ip, ua],
    );

    return ok({
      accessToken,
      refreshToken,
      expiresIn: 2 * 60 * 60,
      user: profile.user,
    }, '登录成功');
  } catch (e) {
    return jsonError(e);
  }
}
