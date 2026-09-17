// /api/edu/course — 选课中心（学生）
// GET  选课目录：课程+教学班+名额实时；含本人已选标记
// POST { action: 'enroll' | 'drop', classId }
// 防超卖：条件 UPDATE (enrolled < capacity)；防重选：edu_elect 唯一键
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { requireRoles, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';

export { preflight as onRequestOptions };

const TERM = '2026-2027-1';

export async function onRequestGet(context) {
  try {
    const { userId } = await requireRoles(context, ['student', 'admin', 'counselor', 'teacher', 'leader']);
    const rows = await query(
      `SELECT e.id AS class_id, e.term, e.capacity, e.enrolled, e.week_day, e.section, e.classroom, e.status AS class_status,
              c.code AS course_code, c.name AS course_name, c.credit, c.hours,
              u.real_name AS teacher_name,
              (SELECT COUNT(*) FROM edu_elect x WHERE x.class_id = e.id AND x.student_id = ? AND x.status = 1) AS mine
         FROM edu_class e
         JOIN edu_course c ON c.id = e.course_id
         JOIN sys_user u ON u.id = e.teacher_id
        WHERE e.term = ? AND e.status = 1 AND c.status = 1
        ORDER BY c.code, e.id`,
      [userId, TERM],
    );
    return ok({
      term: TERM,
      list: rows.map((r) => ({
        ...r,
        remaining: Math.max(0, r.capacity - r.enrolled),
        mine: Number(r.mine) > 0,
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId } = await requireRoles(context, ['student']);
    const body = await readBody(context.request);
    const action = String(body.action || '');
    const classId = Number(body.classId);
    if (!classId) return fail(42001, '缺少 classId');

    const classes = await query('SELECT id, capacity, enrolled, status FROM edu_class WHERE id = ? AND term = ?', [
      classId,
      TERM,
    ]);
    if (classes.length === 0) return fail(42004, '教学班不存在');
    const cls = classes[0];

    if (action === 'enroll') {
      if (cls.status !== 1) return fail(42002, '该教学班已停止选课');
      // 并发选课事务：先唯一键占位，再条件 UPDATE 扣名额
      try {
        await withTransaction(async (conn) => {
          const [ins] = await conn.query(
            'INSERT IGNORE INTO edu_elect (class_id, student_id, term) VALUES (?, ?, ?)',
            [classId, userId, TERM],
          );
          if (ins.affectedRows === 0) throw new Error('DUPLICATE');
          const [upd] = await conn.query(
            'UPDATE edu_class SET enrolled = enrolled + 1 WHERE id = ? AND status = 1 AND enrolled < capacity',
            [classId],
          );
          if (upd.affectedRows === 0) throw new Error('FULL');
        });
      } catch (e) {
        if (e.message === 'DUPLICATE') return fail(42003, '本学期已选过该教学班，请刷新查看');
        if (e.message === 'FULL') return fail(42005, '手慢了，名额已满');
        throw e;
      }
      const [after] = await query('SELECT enrolled, capacity FROM edu_class WHERE id = ?', [classId]);
      return ok(after[0], '选课成功');
    }

    if (action === 'drop') {
      try {
        await withTransaction(async (conn) => {
          const [upd] = await conn.query(
            'UPDATE edu_elect SET status = 0 WHERE class_id = ? AND student_id = ? AND status = 1',
            [classId, userId],
          );
          if (upd.affectedRows === 0) throw new Error('NOT_ENROLLED');
          await conn.query('UPDATE edu_class SET enrolled = GREATEST(enrolled - 1, 0) WHERE id = ?', [classId]);
        });
      } catch (e) {
        if (e.message === 'NOT_ENROLLED') return fail(42006, '未选中该课程或已退课');
        throw e;
      }
      const after = await query('SELECT enrolled, capacity FROM edu_class WHERE id = ?', [classId]);
      return ok(after[0], '退课成功');
    }

    return fail(42001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
