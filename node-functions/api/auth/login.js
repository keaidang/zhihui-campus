// POST /api/auth/login — 统一登录（JWT 双令牌 + 失败锁定 + 审计）
import bcrypt from 'bcryptjs';
import { query } from '../lib/db.js';
import { ok, fail, jsonError, readBody, clientIp } from '../lib/http.js';
import { signAccessToken, newRefreshToken, saveRefreshToken, isLocked, recordFail, clearFail } from '../lib/auth.js';

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const username = String(body.username || '').trim().slice(0, 32);
    const password = String(body.password || '');
    const ip = clientIp(context.request);
    const ua = (context.request.headers.get('user-agent') || '').slice(0, 255);
    const lockKey = `${ip}:${username}`;

    if (!username || !password) return fail(41001, '请输入用户名和密码');
    if (isLocked(lockKey)) {
      return fail(42900, '失败次数过多，请 10 分钟后再试', 429);
    }

    const users = await query(
      'SELECT id, username, password_hash, real_name, status FROM sys_user WHERE username = ?',
      [username],
    );
    const user = users[0];
    const valid = user && (await bcrypt.compare(password, user.password_hash));

    if (!valid) {
      recordFail(lockKey);
      await query(
        'INSERT INTO sys_login_log (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, 0)',
        [user ? user.id : null, username, ip, ua],
      );
      // 模糊提示，不暴露"用户存在与否"
      return fail(40101, '用户名或密码错误');
    }
    if (user.status !== 1) return fail(40300, '账号已被禁用，请联系管理员');

    clearFail(lockKey);
    const roles = (await query(
      `SELECT r.code FROM sys_role r
        JOIN sys_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = ?`,
      [user.id],
    )).map((r) => r.code);

    const accessToken = signAccessToken(user, roles);
    const refreshToken = newRefreshToken();
    await saveRefreshToken(user.id, refreshToken);
    await query('UPDATE sys_user SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await query(
      'INSERT INTO sys_login_log (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, 1)',
      [user.id, username, ip, ua],
    );

    return ok({
      accessToken,
      refreshToken,
      expiresIn: 2 * 60 * 60,
      user: { id: user.id, username: user.username, realName: user.real_name, roles },
    });
  } catch (e) {
    return jsonError(e);
  }
}
