// /api/edu/teach — 教师：我的教学班 + 选课名单
// GET           教学班列表（含选课人数）
// GET ?classId= 该班选课学生名单
import { ok, fail, jsonError, preflight } from '../../lib/http.js';
import { requireRoles, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

const TERM = '2026-2027-1';

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context, ['teacher', 'admin']);
    const url = new URL(context.request.url);
    const classId = Number(url.searchParams.get('classId'));

    if (classId) {
      const classes = await query('SELECT id, teacher_id FROM edu_class WHERE id = ? AND term = ?', [classId, TERM]);
      if (classes.length === 0) return fail(42004, '教学班不存在');
      if (roles.includes('teacher') && !roles.includes('admin') && classes[0].teacher_id !== userId) {
        throw ERR_FORBIDDEN('只能查看自己的教学班');
      }
      const rows = await query(
        `SELECT e.student_id, e.score, e.grade, e.status,
                u.real_name, u.user_no, u.username, cl.name AS class_name, d.name AS dept_name
           FROM edu_elect e
           JOIN sys_user u ON u.id = e.student_id
           LEFT JOIN sys_class cl ON cl.id = u.class_id
           LEFT JOIN sys_department d ON d.id = u.dept_id
          WHERE e.class_id = ? AND e.status IN (1, 2)
          ORDER BY u.user_no, u.username`,
        [classId],
      );
      return ok({ list: rows });
    }

    const adminOnly = roles.includes('admin') && !roles.includes('teacher');
    const list = await query(
      `SELECT x.id AS class_id, x.enrolled, x.capacity, x.week_day, x.section, x.classroom,
              c.code AS course_code, c.name AS course_name, c.credit, c.hours,
              (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = x.id AND e.status = 2) AS graded_count
         FROM edu_class x JOIN edu_course c ON c.id = x.course_id
        WHERE x.term = ? ${adminOnly ? '' : 'AND x.teacher_id = ?'}
        ORDER BY c.code`,
      adminOnly ? [TERM] : [TERM, userId],
    );
    return ok({ list });
  } catch (e) {
    return jsonError(e);
  }
}
