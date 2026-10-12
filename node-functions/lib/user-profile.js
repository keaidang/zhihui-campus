// node-functions/lib/user-profile.js — 「会话用户对象」的单一来源
//
// 为什么单独抽出来（2026-10-12）：
//   /auth/me、/auth/login、/auth/login-code、/auth/refresh 四个入口都要把
//   "用户 id" 变成"前端可直接渲染的 user 对象"。此前只有 /auth/me 返回完整字段，
//   另三个都只返回 { id, username, realName, roles }，于是前端在每个入口后面
//   都得**再补发一次 GET /api/auth/me** 才能拿到 deptName / avatarUrl 等字段。
//   → 后果①：登录、刷新各多一次**串行网络往返**（单次 2~3 秒，首屏白屏时间的一半就是它）；
//   → 后果②：四处各写一遍字段映射，漏一个就是"某条路径上字段 undefined"的静默缺口。
//
// 本模块是这四个入口共用的唯一字段来源。新增字段只改这里。
import { query } from './db.js';

/**
 * 组装会话用户对象（字段与 GET /api/auth/me 的返回体保持一致）。
 * @param {number|string} userId sys_user.id
 * @returns {Promise<null | { status: number, validUntil: any, roles: string[],
 *           roleNames: string[], user: object }>}
 *          用户不存在时返回 null（调用方自行决定如何报错）。
 *          `status` / `validUntil` 是**给调用方做账号有效性校验用的**，不放进 user 返回体。
 */
export async function buildSessionUser(userId) {
  const rows = await query(
    `SELECT u.id, u.username, u.real_name, u.user_no, u.email, u.phone, u.avatar_url,
            u.campus_email, u.mail_enabled, u.last_login_at, u.dept_id, u.class_id,
            u.status, u.valid_until,
            d.name AS dept_name, c.name AS class_name
       FROM sys_user u
       LEFT JOIN sys_department d ON d.id = u.dept_id
       LEFT JOIN sys_class c ON c.id = u.class_id
      WHERE u.id = ?`,
    [userId],
  );
  const user = rows[0];
  if (!user) return null;

  // 角色以数据库为准（管理员刚改过角色时无需等令牌过期）
  const roleRows = await query(
    `SELECT r.code, r.name FROM sys_role r
      JOIN sys_user_role ur ON ur.role_id = r.id
      WHERE ur.user_id = ?`,
    [userId],
  );
  const roles = roleRows.map((r) => r.code);
  const roleNames = roleRows.map((r) => r.name);

  return {
    status: Number(user.status),
    validUntil: user.valid_until,
    roles,
    roleNames,
    user: {
      id: user.id,
      username: user.username,
      realName: user.real_name,
      userNo: user.user_no,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      campusEmail: user.campus_email,
      mailEnabled: Number(user.mail_enabled) === 1,
      lastLoginAt: user.last_login_at,
      deptId: user.dept_id,
      deptName: user.dept_name,
      classId: user.class_id,
      className: user.class_name,
      roles,
      roleNames,
    },
  };
}
