// POST /api/auth/logout — 吊销刷新令牌（前端同时清除本地令牌）
import { ok, jsonError, readBody, preflight } from '../../lib/http.js';
import { revokeRefreshToken } from '../../lib/auth.js';
import { edgeBlacklist } from '../../lib/edgegw.js';

export { preflight as onRequestOptions };

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    if (body.refreshToken) {
      await revokeRefreshToken(String(body.refreshToken));
    }
    // 访问令牌写入边缘黑名单：登出后 2h 内的被盗令牌也无法使用（需 EDGE_GW_SECRET）
    const authz = context.request.headers.get('authorization') || '';
    if (authz) {
      await edgeBlacklist(context.request, { token: authz.replace(/^Bearer\s+/i, '').trim() });
    }
    return ok(null, '已退出登录');
  } catch (e) {
    return jsonError(e);
  }
}
