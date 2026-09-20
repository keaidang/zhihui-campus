// /api/edu/course — 选课中心（学生）
// GET  选课目录：课程+教学班+名额实时；含本人已选标记
// POST { action: 'enroll' | 'drop', classId }
// 防超卖：条件 UPDATE (enrolled < capacity)；防重选：edu_elect 唯一键 + upsert 重激活退课记录
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
      // 并发选课事务：先唯一键占位/重激活，再条件 UPDATE 扣名额
      // ON DUPLICATE KEY UPDATE：行不存在则插入(affectedRows=1)；
      // 已退课(status=0)则重激活为修读中(affectedRows=2)；已选/已出分(status=1/2)则无变化(affectedRows=0)→DUPLICATE
      try {
        await withTransaction(async (conn) => {
          // 时段冲突校验：同一学期，同一天且节次区间重叠的课程只能选一门
          const [mine] = await conn.query(
            `SELECT c.name, x.week_day, x.section
               FROM edu_elect e
               JOIN edu_class x ON x.id = e.class_id
               JOIN edu_course c ON c.id = x.course_id
              WHERE e.student_id = ? AND e.term = ? AND e.status = 1 AND e.class_id != ?`,
            [userId, TERM, classId],
          );
          const [target] = await conn.query('SELECT week_day, section FROM edu_class WHERE id = ?', [classId]);
          const parseSec = (s) => {
            const m = /^(\d+)\s*-\s*(\d+)节?$/.exec(String(s || '').trim());
            return m ? [Number(m[1]), Number(m[2])] : null;
          };
          const hit = mine.find((r) => {
            if (Number(r.week_day) !== Number(target[0].week_day)) return false;
            const a = parseSec(target[0].section);
            const b = parseSec(r.section);
            if (a && b) return a[0] <= b[1] && b[0] <= a[1]; // 区间重叠
            return String(r.section).trim() === String(target[0].section).trim(); // 非标准节次按同串冲突
          });
          if (hit) throw new Error(`CONFLICT|${hit.name}|${hit.section}`);

          const [ups] = await conn.query(
            `INSERT INTO edu_elect (class_id, student_id, term, status) VALUES (?, ?, ?, 1)
               ON DUPLICATE KEY UPDATE status = IF(status = 2, status, 1)`,
            [classId, userId, TERM],
          );
          if (ups.affectedRows === 0) throw new Error('DUPLICATE');
          const [upd] = await conn.query(
            'UPDATE edu_class SET enrolled = enrolled + 1 WHERE id = ? AND status = 1 AND enrolled < capacity',
            [classId],
          );
          if (upd.affectedRows === 0) throw new Error('FULL');
        });
      } catch (e) {
        if (String(e.message || '').startsWith('CONFLICT|')) {
          const [, courseName, sec] = e.message.split('|');
          return fail(42007, `时段冲突：与已选的「${courseName}」（${sec}）时间重叠，不能同时选`);
        }
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
