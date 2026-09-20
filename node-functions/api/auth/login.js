// POST /api/auth/login — 统一登录（JWT 双令牌 + 失败锁定 + 审计）
import bcrypt from 'bcryptjs';
import { query } from '../../lib/db.js';
import { ok, fail, jsonError, readBody, clientIp } from '../../lib/http.js';
import { signAccessToken, newRefreshToken, saveRefreshToken, isLocked, recordFail, clearFail } from '../../lib/auth.js';
import { preflight } from '../../lib/http.js';

export { preflight as onRequestOptions };

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

    // 接口限流（市面常见频率，DB 流水计数——多实例安全）。
    // ★ 注意：Node 侧 x-forwarded-for 是 EdgeOne 出口代理 IP（会在代理池多个 IP 间交替），
    //   不是真实客户端 IP——因此防撞库按"账号"维度计数（撞库的本质即按账号爆破），
    //   IP 维度阈值放宽（出口池稀释），仅作辅助。
    const fa = await query(
      'SELECT COUNT(*) n FROM sys_login_log WHERE username = ? AND success = 0 AND created_at > NOW() - INTERVAL 60 SECOND',
      [username],
    );
    if (Number(fa[0].n) >= 5) return fail(42900, '该账号登录尝试过于频繁，请 1 分钟后再试', 429);
    const fi = await query(
      'SELECT COUNT(*) n FROM sys_login_log WHERE ip = ? AND success = 0 AND created_at > NOW() - INTERVAL 60 SECOND',
      [ip],
    );
    if (Number(fi[0].n) >= 60) return fail(42900, '请求过于频繁，请稍后再试', 429);

    const users = await query(
      'SELECT id, username, password_hash, real_name, status, valid_until FROM sys_user WHERE username = ?',
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
    if (user.valid_until && new Date(user.valid_until).getTime() < Date.now()) {
      return fail(40300, '账号已过有效期，请联系管理员续期');
    }

    clearFail(lockKey);
    const roles = (await query(
      `SELECT r.code FROM sys_role r
        JOIN sys_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = ?`,
      [user.id],
    )).map((r) => r.code);

    // ★ 顺带清理（5% 概率触发，自助维护表体积）：过期超 7 天的刷新令牌 + 吊销超 30 天的令牌
    if (Math.random() < 0.05) {
      try {
        await query(
          `DELETE FROM sys_refresh_token
            WHERE (expires_at < NOW() - INTERVAL 7 DAY)
               OR (revoked = 1 AND created_at < NOW() - INTERVAL 30 DAY)`,
        );
      } catch { /* 清理失败不影响登录 */ }
    }

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
