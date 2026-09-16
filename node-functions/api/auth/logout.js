// POST /api/auth/logout — 吊销刷新令牌（前端同时清除本地令牌）
import { ok, jsonError, readBody } from '../../lib/http.js';
import { revokeRefreshToken } from '../../lib/auth.js';

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    if (body.refreshToken) {
      await revokeRefreshToken(String(body.refreshToken));
    }
    return ok(null, '已退出登录');
  } catch (e) {
    return jsonError(e);
  }
}
