// /api/admin/classes — 班级管理
// GET   班级列表（含辅导员与在读人数）+ 辅导员名单（供指派下拉）
//       admin（全校）；counselor（仅本人带班）
// POST  action: create | update | delete （仅 admin）
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, MANAGER_ROLES, ERR_FORBIDDEN, opLog } from '../../lib/guard.js';
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
    const list = roles.includes('admin')
      ? await query(`${base} ORDER BY d.sort, c.id`)
      : await query(`${base} WHERE c.counselor_id = ? ORDER BY c.id`, [userId]);
    // 辅导员名单（指派下拉用；仅 admin 需要全量）
    const counselors = roles.includes('admin')
      ? await query(
          `SELECT DISTINCT u.id, u.real_name, u.user_no, d.name AS dept_name
             FROM sys_user u
             JOIN sys_user_role ur ON ur.user_id = u.id
             JOIN sys_role r ON r.id = ur.role_id
             LEFT JOIN sys_department d ON d.id = u.dept_id
            WHERE r.code = 'counselor' AND u.status = 1
            ORDER BY u.user_no`,
        )
      : [];
    return ok({ list, counselors });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { roles, userId: operatorId } = await requireRoles(context, MANAGER_ROLES);
    if (!roles.includes('admin')) throw ERR_FORBIDDEN('仅超级管理员可维护班级');
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || 'create');

    if (action === 'create' || action === 'update') {
      const name = String(body.name || '').trim().slice(0, 64);
      const deptId = Number(body.deptId);
      const grade = Number(body.grade) || 0;

      if (action === 'create') {
        if (!name) return fail(41100, '班级名称必填');
        if (!deptId) return fail(41100, '所属院系必选');
        const dup = await query('SELECT id FROM sys_class WHERE name = ? AND dept_id = ?', [name, deptId]);
        if (dup.length) return fail(41101, '同一院系下班级名称已存在');
        const counselorId = body.counselorId ? Number(body.counselorId) : null;
        const r = await query('INSERT INTO sys_class (dept_id, name, grade, counselor_id) VALUES (?, ?, ?, ?)', [
          deptId, name, grade, counselorId,
        ]);
        await opLog(operatorId, 'class.create', `class:${r.insertId}`, name, ip);
        return ok({ id: r.insertId }, '班级已创建');
      }

      const id = Number(body.id);
      if (!id) return fail(41100, '缺少班级 id');
      const sets = [];
      const params = [];
      if (name) { sets.push('name = ?'); params.push(name); }
      if (deptId) { sets.push('dept_id = ?'); params.push(deptId); }
      if (body.grade != null) { sets.push('grade = ?'); params.push(grade); }
      if (body.counselorId !== undefined) {
        sets.push('counselor_id = ?');
        params.push(body.counselorId ? Number(body.counselorId) : null);
      }
      if (!sets.length) return fail(41100, '无可更新字段');
      params.push(id);
      await query(`UPDATE sys_class SET ${sets.join(', ')} WHERE id = ?`, params);
      await opLog(operatorId, 'class.update', `class:${id}`, sets.join(','), ip);
      return ok({ id }, '班级已更新');
    }

    if (action === 'delete') {
      const id = Number(body.id);
      if (!id) return fail(41100, '缺少班级 id');
      const students = await query('SELECT COUNT(*) n FROM sys_user WHERE class_id = ?', [id]);
      if (Number(students[0].n) > 0) return fail(41102, `该班级还有 ${students[0].n} 名在读学生，不能删除（请先调班）`);
      await query('DELETE FROM sys_class WHERE id = ?', [id]);
      await opLog(operatorId, 'class.delete', `class:${id}`, '', ip);
      return ok(null, '班级已删除');
    }

    return fail(41100, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
