// GET /api/admin/meta — 管理端基础元数据（角色列表 + 院系列表 + 班级列表）
// 权限：admin / counselor
import { ok, jsonError, preflight } from '../../lib/http.js';
import { requireRoles, MANAGER_ROLES, dataScope } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const { roles, deptId } = await requireRoles(context, MANAGER_ROLES);
    const scope = dataScope(roles, deptId);

    const roleRows = await query('SELECT code, name, description FROM sys_role ORDER BY id');
    const deptRows = await query(
      'SELECT id, code, name, status FROM sys_department WHERE status = 1 ORDER BY sort, id',
    );
    // 班级：admin 全量，counselor 仅本院
    const classRows =
      scope.type === 'all'
        ? await query('SELECT id, dept_id, name, grade FROM sys_class ORDER BY dept_id, id')
        : await query('SELECT id, dept_id, name, grade FROM sys_class WHERE dept_id = ? ORDER BY id', [
            scope.deptId,
          ]);

    return ok({
      roles: roleRows,
      departments: deptRows,
      classes: classRows,
      scope,
      // 角色编码 → 名称映射，前端展示用
      roleNames: Object.fromEntries(roleRows.map((r) => [r.code, r.name])),
    });
  } catch (e) {
    return jsonError(e);
  }
}
