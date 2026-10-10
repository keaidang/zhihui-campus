// /api/edu/score — 成绩
// GET    学生: 本人成绩单; 教师: 指定教学班名单(?classId=)
// POST   教师录入成绩 { classId, items: [{ studentId, score }] }
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { requireRoles, ERR_FORBIDDEN, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
// 学级/绩点/学分口径统一来自 lib/edu-stats.js（C7 学业助手用同一份，避免同一系统两个答案）
import { CURRENT_TERM as TERM, gradeOf, summarizeStudies, termLabel } from '../../lib/edu-stats.js';

export { preflight as onRequestOptions };
export { gradeOf };

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const url = new URL(context.request.url);

    if (roles.includes('student') && !roles.includes('teacher')) {
      // ★ 支持 ?term=YYYY-NNN-N 查往期成绩；不传则默认当前学期（既有行为不变）。
      //   为什么需要：成绩数据挂在历史学期（当前学期只该有"在选"，见
      //   scripts/seed-demo-data.mjs 的事故记录），如果这里写死当前学期，
      //   学生打开成绩页会看到空的 —— 等于造的数据在页面上不可见。
      const term = String(url.searchParams.get('term') || TERM).trim() || TERM;
      const rows = await query(
        `SELECT e.score, e.grade, e.status, c.name AS course_name, c.code AS course_code, c.credit,
                u.real_name AS teacher_name, x.classroom
           FROM edu_elect e
           JOIN edu_class x ON x.id = e.class_id
           JOIN edu_course c ON c.id = x.course_id
           JOIN sys_user u ON u.id = x.teacher_id
          WHERE e.student_id = ? AND e.term = ? AND e.status IN (1, 2)
          ORDER BY c.code`,
        [userId, term],
      );
      // 该生有记录的学期列表（供前端学期下拉；只列本人可见的学期）
      const termRows = await query(
        `SELECT DISTINCT e.term FROM edu_elect e
          WHERE e.student_id = ? AND e.status IN (1, 2)
          ORDER BY e.term DESC`,
        [userId],
      );
      const s = summarizeStudies(rows);
      return ok({
        term,
        currentTerm: TERM,
        terms: termRows.map((t) => ({ term: t.term, label: termLabel(t.term) })),
        list: rows,
        // 字段名沿用改造前的响应形状（前端与 e2e 都按这些键取值）
        summary: {
          courseCount: s.gradedCount,
          creditsEarned: s.creditsEarned,
          creditsTotal: s.creditsAttempted,
          gpa: s.gpa,
        },
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
