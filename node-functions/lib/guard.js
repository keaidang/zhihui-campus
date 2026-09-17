// node-functions/lib/guard.js — 鉴权与数据范围中间件（所有业务模块统一入口）
// 设计：
//  - 认证：Bearer accessToken（JWT HS256），载荷 sub/username/roles
//  - 授权：requireRoles 实时查库拿角色（JWT 角色可能过期，权限判定不信令牌）
//  - 数据范围：scope = self / dept / all，SQL 层强制拼接，前端只做展示过滤
import { verifyAccessToken } from './auth.js';
import { query } from './db.js';
import { fail } from './http.js';

/** 业务错误：jsonError 会识别并按自带 status 返回 */
export class HttpError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
  toResponse() {
    return fail(this.code, this.message, this.status);
  }
}

export const ERR_UNAUTHORIZED = () => new HttpError(40103, '登录状态已失效，请重新登录', 401);
export const ERR_FORBIDDEN = (msg = '暂无权限执行该操作') => new HttpError(40301, msg, 403);

/** 解析 Authorization: Bearer <token>；无效返回 null */
export function getAuth(context) {
  const raw = context.request.headers.get('authorization') || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token) return null;
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

/** 必须是登录用户；返回 JWT 载荷 */
export function requireAuth(context) {
  const payload = getAuth(context);
  if (!payload) throw ERR_UNAUTHORIZED();
  return payload;
}

/**
 * 必须拥有指定角色之一；角色以数据库为准（避免令牌里角色过期导致越权）
 * @returns {{ payload: object, roles: string[], userId: number, deptId: number|null }}
 */
export async function requireRoles(context, allowed = []) {
  const payload = requireAuth(context);
  const userId = Number(payload.sub);
  const rows = await query(
    `SELECT r.code, u.dept_id FROM sys_user_role ur
       JOIN sys_role r ON r.id = ur.role_id
       JOIN sys_user u ON u.id = ur.user_id
      WHERE ur.user_id = ? AND u.status = 1`,
    [userId],
  );
  if (rows.length === 0) throw ERR_UNAUTHORIZED();
  const roles = rows.map((r) => r.code);
  if (allowed.length > 0 && !roles.some((r) => allowed.includes(r))) {
    throw ERR_FORBIDDEN();
  }
  return { payload, roles, userId, deptId: rows[0].dept_id ?? null };
}

/**
 * 数据范围：returns { type: 'all' | 'dept', deptId }
 * admin/leader 看全校；counselor 看本院；其他角色只能看本人（调用方自行按 userId 过滤）
 */
export function dataScope(roles, deptId) {
  if (roles.includes('admin') || roles.includes('leader')) return { type: 'all', deptId: null };
  if (roles.includes('counselor') && deptId) return { type: 'dept', deptId };
  return { type: 'self', deptId: null };
}

/** 常用：管理端角色（超管 + 辅导员可进，具体能力在各自接口内用 scope 区分） */
export const ADMIN_ROLES = ['admin'];
export const MANAGER_ROLES = ['admin', 'counselor'];
export const STAFF_ROLES = ['admin', 'counselor', 'teacher', 'leader'];
