// /api/admin/users — 用户管理（列表/搜索/改状态/分配角色/设归属）
// 权限：admin（全校）、counselor（仅本院，且不能改角色）
// GET  分页列表  ?keyword=&role=&deptId=&status=&page=1&pageSize=20
// POST 单条操作  { userId, action: setStatus | setRoles | setProfile, value }
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { requireRoles, MANAGER_ROLES, dataScope, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';

export { preflight as onRequestOptions };

const PAGE_MAX = 100;

export async function onRequestGet(context) {
  try {
    const { roles, deptId } = await requireRoles(context, MANAGER_ROLES);
    const scope = dataScope(roles, deptId);
    const url = new URL(context.request.url);
    const keyword = (url.searchParams.get('keyword') || '').trim().slice(0, 32);
    const role = (url.searchParams.get('role') || '').trim().slice(0, 32);
    const status = url.searchParams.get('status');
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const pageSize = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('pageSize') || 20)));

    const where = ['1 = 1'];
    const params = [];
    if (scope.type === 'dept') {
      where.push('u.dept_id = ?');
      params.push(scope.deptId);
    }
    if (keyword) {
      where.push('(u.username LIKE ? OR u.real_name LIKE ? OR u.user_no LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }
    if (status === '0' || status === '1') {
      where.push('u.status = ?');
      params.push(Number(status));
    }
    if (role) {
      where.push('EXISTS (SELECT 1 FROM sys_user_role x JOIN sys_role r2 ON r2.id = x.role_id WHERE x.user_id = u.id AND r2.code = ?)');
      params.push(role);
    }
    const whereSql = where.join(' AND ');

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM sys_user u WHERE ${whereSql}`, params);
    const rows = await query(
      `SELECT u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id, u.class_id,
              u.created_at, u.last_login_at,
              d.name AS dept_name, c.name AS class_name,
              GROUP_CONCAT(r.code) AS role_codes
         FROM sys_user u
         LEFT JOIN sys_department d ON d.id = u.dept_id
         LEFT JOIN sys_class c ON c.id = u.class_id
         LEFT JOIN sys_user_role ur ON ur.user_id = u.id
         LEFT JOIN sys_role r ON r.id = ur.role_id
        WHERE ${whereSql}
        GROUP BY u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id, u.class_id,
                 u.created_at, u.last_login_at, d.name, c.name
        ORDER BY u.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return ok({
      list: rows.map((r) => ({ ...r, roles: r.role_codes ? String(r.role_codes).split(',') : [] })),
      total: Number(total),
      page,
      pageSize,
      scope,
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { roles, userId: operatorId } = await requireRoles(context, MANAGER_ROLES);
    const scope = dataScope(roles, null);
    const isAdmin = roles.includes('admin');
    const body = await readBody(context.request);
    const targetId = Number(body.userId);
    const action = String(body.action || '');
    const value = body.value;

    if (!targetId) return fail(41001, '缺少 userId');

    const targets = await query('SELECT id, username, dept_id FROM sys_user WHERE id = ?', [targetId]);
    if (targets.length === 0) return fail(41004, '用户不存在');
    const target = targets[0];

    // 辅导员只能操作本院用户
    if (!isAdmin) {
      const my = await query('SELECT dept_id FROM sys_user WHERE id = ?', [operatorId]);
      if (!my[0]?.dept_id || my[0].dept_id !== target.dept_id) throw ERR_FORBIDDEN('只能管理本院用户');
    }

    if (action === 'setStatus') {
      const next = Number(value) === 1 ? 1 : 0;
      if (targetId === operatorId) return fail(41005, '不能修改自己的账号状态');
      await query('UPDATE sys_user SET status = ? WHERE id = ?', [next, targetId]);
      return ok({ userId: targetId, status: next }, next === 1 ? '账号已启用' : '账号已禁用');
    }

    if (action === 'setProfile') {
      const userNo = String(value?.userNo ?? '').trim().slice(0, 32);
      const deptId = value?.deptId ? Number(value.deptId) : null;
      const classId = value?.classId ? Number(value.classId) : null;
      if (!isAdmin && deptId && deptId !== target.dept_id) throw ERR_FORBIDDEN('不能调整到其他院系');
      await query('UPDATE sys_user SET user_no = ?, dept_id = ?, class_id = ? WHERE id = ?', [
        userNo,
        deptId,
        classId,
        targetId,
      ]);
      return ok({ userId: targetId }, '归属信息已更新');
    }

    if (action === 'setRoles') {
      if (!isAdmin) throw ERR_FORBIDDEN('仅超级管理员可分配角色');
      const codes = Array.isArray(value) ? value.map((c) => String(c)).slice(0, 10) : [];
      if (codes.length === 0) return fail(41001, '至少保留一个角色');
      const roleRows = await query(
        `SELECT id, code FROM sys_role WHERE code IN (${codes.map(() => '?').join(',')})`,
        codes,
      );
      if (roleRows.length !== codes.length) return fail(41001, '存在无效角色编码');
      // 不能把自己的 admin 角色摘掉（防自锁）
      if (targetId === operatorId && !codes.includes('admin')) {
        return fail(41006, '不能移除自己的超级管理员角色');
      }
      await withTransaction(async (conn) => {
        await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [targetId]);
        for (const r of roleRows) {
          await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [
            targetId,
            r.id,
          ]);
        }
      });
      return ok({ userId: targetId, roles: codes }, '角色已更新（重新登录后菜单生效）');
    }

    return fail(41001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
