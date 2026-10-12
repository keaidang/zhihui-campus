// GET /api/auth/me — 获取当前登录用户信息（需 Bearer Token）
import { ok, fail, jsonError, preflight } from '../../lib/http.js';
import { verifyAccessToken } from '../../lib/auth.js';
import { buildSessionUser } from '../../lib/user-profile.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const auth = context.request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return fail(40100, '未登录', 401);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return fail(40100, '登录状态已失效', 401);
    }

    // 字段组装统一走 lib/user-profile.js（与 /auth/login、/auth/refresh 同源，避免字段漂移）
    const profile = await buildSessionUser(Number(payload.sub));
    // status !== 1 视为不可用（此前该条件写在 SQL 的 WHERE 里，抽到公共模块后在此显式判定）
    if (!profile || profile.status !== 1) return fail(40100, '用户不存在或已禁用', 401);

    return ok({
      ...profile.user,
      // 令牌里带的角色，供前端对比"角色已变更但令牌未过期"的场景
      tokenRoles: payload.roles || [],
    });
  } catch (e) {
    return jsonError(e);
  }
}
