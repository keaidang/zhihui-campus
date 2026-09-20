// POST /api/auth/refresh — 刷新访问令牌（轮换刷新令牌）
import { query } from '../../lib/db.js';
import { ok, fail, jsonError, readBody } from '../../lib/http.js';
import { signAccessToken, rotateRefreshTokenAtomic, rateLimit } from '../../lib/auth.js';
import { clientIp, preflight } from '../../lib/http.js';

export { preflight as onRequestOptions };

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const refreshToken = String(body.refreshToken || '');
    if (!refreshToken) return fail(40100, '缺少刷新令牌', 401);

    // 接口限流：30/min/IP（正常用户分钟级刷新个位数次）
    if (!rateLimit('refresh', String(clientIp(context.request)).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64), 30, 60)) {
      return fail(42900, '请求过于频繁，请稍后再试', 429);
    }

    // 原子轮换（事务+瞬时重试）：失败即回滚，旧令牌仍有效，客户端可重试
    const result = await rotateRefreshTokenAtomic(refreshToken);
    if (!result.ok) {
      const msg = { not_found: '刷新令牌无效', expired: '登录已过期，请重新登录', replayed: '检测到异常会话，请重新登录' }[result.reason];
      return fail(40100, msg || '刷新失败', 401);
    }

    const users = await query(
      'SELECT id, username, real_name, status, valid_until FROM sys_user WHERE id = ?',
      [result.userId],
    );
    const user = users[0];
    if (!user || user.status !== 1) return fail(40300, '账号不可用', 403);
    if (user.valid_until && new Date(user.valid_until).getTime() < Date.now()) {
      return fail(40300, '账号已过有效期，请联系管理员续期', 403);
    }

    const roles = (await query(
      `SELECT r.code FROM sys_role r
        JOIN sys_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = ?`,
      [user.id],
    )).map((r) => r.code);

    return ok({
      accessToken: signAccessToken(user, roles),
      refreshToken: result.nextToken,
      expiresIn: 2 * 60 * 60,
      user: { id: user.id, username: user.username, realName: user.real_name, roles },
    });
  } catch (e) {
    return jsonError(e);
  }
}
