// /api/admin/classes — 班级列表（含辅导员与在读人数）
// 权限：admin（全校）；counselor（仅本人带班）
import { ok, jsonError, preflight } from '../../lib/http.js';
import { requireRoles, MANAGER_ROLES } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const { roles, userId } = await requireRoles(context, MANAGER_ROLES);
    const base = `SELECT c.id, c.name, c.grade, c.dept_id, c.counselor_id,
                         d.name AS dept_name, u.real_name AS counselor_name,
                         (SELECT COUNT(*) FROM sys_user s WHERE s.class_id = c.id AND s.status = 1) AS student_count
                    FROM sys_class c
                    LEFT JOIN sys_department d ON d.id = c.dept_id
                    LEFT JOIN sys_user u ON u.id = c.counselor_id`;
    const rows = roles.includes('admin')
      ? await query(`${base} ORDER BY d.sort, c.id`)
      : await query(`${base} WHERE c.counselor_id = ? ORDER BY c.id`, [userId]);
    return ok({ list: rows });
  } catch (e) {
    return jsonError(e);
  }
}
