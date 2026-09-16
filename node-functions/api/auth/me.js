// GET /api/auth/me — 获取当前登录用户信息（需 Bearer Token）
import { query } from '../../lib/db.js';
import { ok, fail, jsonError } from '../../lib/http.js';
import { verifyAccessToken } from '../../lib/auth.js';

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

    const users = await query(
      'SELECT id, username, real_name, email, phone, avatar_url, last_login_at FROM sys_user WHERE id = ? AND status = 1',
      [Number(payload.sub)],
    );
    const user = users[0];
    if (!user) return fail(40100, '用户不存在或已禁用', 401);

    return ok({
      id: user.id,
      username: user.username,
      realName: user.real_name,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      lastLoginAt: user.last_login_at,
      roles: payload.roles || [],
    });
  } catch (e) {
    return jsonError(e);
  }
}
