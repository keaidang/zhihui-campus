// /api/edu/score — 成绩
// GET    学生: 本人成绩单; 教师: 指定教学班名单(?classId=)
// POST   教师录入成绩 { classId, items: [{ studentId, score }] }
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { requireRoles, ERR_FORBIDDEN, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

const TERM = '2026-2027-1';

export function gradeOf(score) {
  if (score >= 90) return '优秀';
  if (score >= 80) return '良好';
  if (score >= 70) return '中等';
  if (score >= 60) return '及格';
  return '不及格';
}

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const url = new URL(context.request.url);

    if (roles.includes('student') && !roles.includes('teacher')) {
      const rows = await query(
        `SELECT e.score, e.grade, e.status, c.name AS course_name, c.code AS course_code, c.credit,
                u.real_name AS teacher_name, x.classroom
           FROM edu_elect e
           JOIN edu_class x ON x.id = e.class_id
           JOIN edu_course c ON c.id = x.course_id
           JOIN sys_user u ON u.id = x.teacher_id
          WHERE e.student_id = ? AND e.term = ? AND e.status IN (1, 2)
          ORDER BY c.code`,
        [userId, TERM],
      );
      const graded = rows.filter((r) => r.status === 2 && r.score !== null);
      const credits = graded.reduce((s, r) => s + Number(r.credit), 0);
      const earned = graded.filter((r) => Number(r.score) >= 60).reduce((s, r) => s + Number(r.credit), 0);
      const gpa =
        credits > 0
          ? graded
              .filter((r) => Number(r.score) >= 60)
              .reduce((s, r) => {
                const sc = Number(r.score);
                const gp = sc >= 90 ? 4.0 : sc >= 80 ? 3.0 : sc >= 70 ? 2.0 : 1.0;
                return s + (gp * Number(r.credit));
              }, 0) / earned
          : 0;
      return ok({
        list: rows,
        summary: { courseCount: graded.length, creditsEarned: earned, creditsTotal: credits, gpa: Math.round(gpa * 100) / 100 },
      });
    }

    if (roles.includes('teacher') || roles.includes('admin')) {
      const classId = Number(url.searchParams.get('classId'));
      if (!classId) return fail(42001, '缺少 classId');
      if (roles.includes('teacher') && !roles.includes('admin')) {
        const own = await query('SELECT id FROM edu_class WHERE id = ? AND teacher_id = ?', [classId, userId]);
        if (own.length === 0) throw ERR_FORBIDDEN('只能查看自己的教学班');
      }
      const rows = await query(
        `SELECT e.student_id, e.score, e.grade, e.status,
                u.real_name, u.user_no, u.username, cl.name AS class_name
           FROM edu_elect e
           JOIN sys_user u ON u.id = e.student_id
           LEFT JOIN sys_class cl ON cl.id = u.class_id
          WHERE e.class_id = ? AND e.status IN (1, 2)
          ORDER BY u.user_no, u.username`,
        [classId],
      );
      return ok({ list: rows });
    }

    throw ERR_FORBIDDEN();
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId, roles } = await requireRoles(context, ['teacher', 'admin']);
    const body = await readBody(context.request);
    const classId = Number(body.classId);
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    if (!classId || items.length === 0) return fail(42001, '缺少 classId 或 items');

    const own = await query('SELECT id FROM edu_class WHERE id = ?', [classId]);
    if (own.length === 0) return fail(42004, '教学班不存在');
    if (roles.includes('teacher') && !roles.includes('admin')) {
      const mine = await query('SELECT id FROM edu_class WHERE id = ? AND teacher_id = ?', [classId, userId]);
      if (mine.length === 0) throw ERR_FORBIDDEN('只能录入自己的教学班');
    }

    let n = 0;
    for (const it of items) {
      const sid = Number(it.studentId);
      const score = Number(it.score);
      if (!sid || Number.isNaN(score) || score < 0 || score > 100) continue;
      await query('UPDATE edu_elect SET score = ?, grade = ?, status = 2 WHERE class_id = ? AND student_id = ?', [
        score,
        gradeOf(score),
        classId,
        sid,
      ]);
      n += 1;
    }
    await opLog(userId, 'edu.scoreEntry', `class:${classId}`, `录入 ${n} 条`, '');
    return ok({ saved: n }, `已保存 ${n} 条成绩`);
  } catch (e) {
    return jsonError(e);
  }
}
