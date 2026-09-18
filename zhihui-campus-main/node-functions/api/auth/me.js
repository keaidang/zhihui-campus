// GET /api/auth/me — 获取当前登录用户信息（需 Bearer Token）
import { query } from '../../lib/db.js';
import { ok, fail, jsonError, preflight } from '../../lib/http.js';
import { verifyAccessToken } from '../../lib/auth.js';

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

    const users = await query(
      `SELECT u.id, u.username, u.real_name, u.user_no, u.email, u.phone, u.avatar_url,
              u.last_login_at, u.dept_id, u.class_id, d.name AS dept_name, c.name AS class_name
         FROM sys_user u
         LEFT JOIN sys_department d ON d.id = u.dept_id
         LEFT JOIN sys_class c ON c.id = u.class_id
        WHERE u.id = ? AND u.status = 1`,
      [Number(payload.sub)],
    );
    const user = users[0];
    if (!user) return fail(40100, '用户不存在或已禁用', 401);

    // 角色以数据库为准（管理员刚改过角色时无需等令牌过期）
    const roleRows = await query(
      `SELECT r.code, r.name FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
        WHERE ur.user_id = ?`,
      [user.id],
    );

    return ok({
      id: user.id,
      username: user.username,
      realName: user.real_name,
      userNo: user.user_no,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      lastLoginAt: user.last_login_at,
      deptId: user.dept_id,
      deptName: user.dept_name,
      classId: user.class_id,
      className: user.class_name,
      roles: roleRows.map((r) => r.code),
      roleNames: roleRows.map((r) => r.name),
      tokenRoles: payload.roles || [],
    });
  } catch (e) {
    return jsonError(e);
  }
}
