// /api/admin/departments — 院系管理（列表 / 新增 / 启停）
// 权限：admin 可写；counselor 只读
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { requireRoles, MANAGER_ROLES, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    await requireRoles(context, MANAGER_ROLES);
    const rows = await query(
      `SELECT d.id, d.code, d.name, d.sort, d.status,
              (SELECT COUNT(*) FROM sys_user u WHERE u.dept_id = d.id) AS user_count,
              (SELECT COUNT(*) FROM sys_class c WHERE c.dept_id = d.id) AS class_count
         FROM sys_department d
        ORDER BY d.sort, d.id`,
    );
    return ok({ list: rows });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { roles } = await requireRoles(context, MANAGER_ROLES);
    if (!roles.includes('admin')) throw ERR_FORBIDDEN('仅超级管理员可维护院系');
    const body = await readBody(context.request);
    const action = String(body.action || 'create');

    if (action === 'create') {
      const code = String(body.code || '').trim().toUpperCase().slice(0, 32);
      const name = String(body.name || '').trim().slice(0, 64);
      const sort = Number(body.sort || 0);
      if (!/^[A-Z0-9_]{2,32}$/.test(code)) return fail(41001, '院系编码须为 2~32 位大写字母/数字/下划线');
      if (!name) return fail(41001, '请填写院系名称');
      const exists = await query('SELECT id FROM sys_department WHERE code = ?', [code]);
      if (exists.length > 0) return fail(41002, '院系编码已存在');
      const r = await query('INSERT INTO sys_department (code, name, sort) VALUES (?, ?, ?)', [
        code,
        name,
        sort,
      ]);
      return ok({ id: r.insertId, code, name }, '院系已创建');
    }

    if (action === 'setStatus') {
      const id = Number(body.id);
      const status = Number(body.value) === 1 ? 1 : 0;
      if (!id) return fail(41001, '缺少院系 id');
      await query('UPDATE sys_department SET status = ? WHERE id = ?', [status, id]);
      return ok({ id, status }, status === 1 ? '院系已启用' : '院系已停用');
    }

    return fail(41001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
