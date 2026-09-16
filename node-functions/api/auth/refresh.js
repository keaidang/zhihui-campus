// POST /api/auth/refresh — 刷新访问令牌（轮换刷新令牌）
import { query } from '../../lib/db.js';
import { ok, fail, jsonError, readBody } from '../../lib/http.js';
import { signAccessToken, rotateRefreshToken, newRefreshToken, saveRefreshToken } from '../../lib/auth.js';

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const refreshToken = String(body.refreshToken || '');
    if (!refreshToken) return fail(40100, '缺少刷新令牌', 401);

    const result = await rotateRefreshToken(refreshToken);
    if (!result.ok) {
      const msg = { not_found: '刷新令牌无效', expired: '登录已过期，请重新登录', replayed: '检测到异常会话，请重新登录' }[result.reason];
      return fail(40100, msg || '刷新失败', 401);
    }

    const users = await query(
      'SELECT id, username, real_name, status FROM sys_user WHERE id = ?',
      [result.userId],
    );
    const user = users[0];
    if (!user || user.status !== 1) return fail(40300, '账号不可用', 403);

    const roles = (await query(
      `SELECT r.code FROM sys_role r
        JOIN sys_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = ?`,
      [user.id],
    )).map((r) => r.code);

    const newRefresh = newRefreshToken();
    await saveRefreshToken(user.id, newRefresh);

    return ok({
      accessToken: signAccessToken(user, roles),
      refreshToken: newRefresh,
      expiresIn: 2 * 60 * 60,
      user: { id: user.id, username: user.username, realName: user.real_name, roles },
    });
  } catch (e) {
    return jsonError(e);
  }
}
