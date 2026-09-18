// /api/edu/timetable — 周课表
// 学生: 本人所选课程; 教师: 本人任教班级; 其他角色 403
import { ok, jsonError, preflight, fail } from '../../lib/http.js';
import { requireRoles, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

const TERM = '2026-2027-1';
const WEEK_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context); // 任一登录角色
    if (roles.includes('student') && !roles.some((r) => ['teacher', 'admin', 'counselor', 'leader'].includes(r))) {
      const rows = await query(
        `SELECT e.id AS elect_id, e.class_id, e.status AS elect_status,
                c.name AS course_name, c.code AS course_code, c.credit,
                x.week_day, x.section, x.classroom, u.real_name AS teacher_name
           FROM edu_elect e
           JOIN edu_class x ON x.id = e.class_id
           JOIN edu_course c ON c.id = x.course_id
           JOIN sys_user u ON u.id = x.teacher_id
          WHERE e.student_id = ? AND e.term = ? AND e.status IN (1, 2)
          ORDER BY x.week_day, x.section`,
        [userId, TERM],
      );
      return ok({ role: 'student', term: TERM, list: rows.map((r) => ({ ...r, week_text: WEEK_CN[r.week_day] })) });
    }
    if (roles.includes('teacher') || roles.includes('admin')) {
      const teacherId = roles.includes('teacher') ? userId : null;
      const rows = teacherId
        ? await query(
            `SELECT x.id AS class_id, x.week_day, x.section, x.classroom, x.enrolled, x.capacity,
                    c.name AS course_name, c.code AS course_code, c.credit
               FROM edu_class x JOIN edu_course c ON c.id = x.course_id
              WHERE x.teacher_id = ? AND x.term = ? ORDER BY x.week_day, x.section`,
            [teacherId, TERM],
          )
        : await query(
            `SELECT x.id AS class_id, x.week_day, x.section, x.classroom, x.enrolled, x.capacity,
                    c.name AS course_name, c.code AS course_code, c.credit, u.real_name AS teacher_name
               FROM edu_class x JOIN edu_course c ON c.id = x.course_id
               JOIN sys_user u ON u.id = x.teacher_id
              WHERE x.term = ? ORDER BY x.week_day, x.section`,
            [TERM],
          );
      return ok({ role: 'teacher', term: TERM, list: rows.map((r) => ({ ...r, week_text: WEEK_CN[r.week_day] })) });
    }
    throw ERR_FORBIDDEN('辅导员/校领导请通过报表查看课程安排');
  } catch (e) {
    return jsonError(e);
  }
}
