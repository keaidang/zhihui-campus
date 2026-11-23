// /api/edu/course — 选课中心（学生）
// GET  选课目录：课程+教学班+名额实时；含本人已选标记
// POST { action: 'enroll' | 'drop', classId }
// 防超卖：条件 UPDATE (enrolled < capacity)；防重选：edu_elect 唯一键 + upsert 重激活退课记录
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';
import { isScheduleConflict } from '../../lib/schedule.js';

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
          // 判定规则在 lib/schedule.js（纯函数，tests/unit/schedule.spec.js 覆盖边界）
          const hit = mine.find((r) =>
            isScheduleConflict(target[0].week_day, target[0].section, r.week_day, r.section),
          );
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
        if (e.message === 'FULL') {
          // ★ 文案必须带上"哪门课、什么时间、满到什么程度"（2026-11-23 改）
          //   原实现只有一句「手慢了，名额已满」—— 学生看到后不知道是哪门课，
          //   也无法判断是"真的满"还是"自己操作错了"。
          //   对比 42007（时段冲突）本来就带课程名与节次，两条错误的可读性差一个量级。
          //   多一次查询只在失败路径发生，不影响正常选课耗时。
          // ★ 注意：`query()` 返回的是**行数组本身**（lib/db.js 内部已 `const [rows]` 解构过），
          //   不是 mysql2 的 `[rows, fields]` 元组；而 `conn.query()`（事务连接）才是元组。
          //   一开始写成了 `const [info] = await query(...)`，于是 info 变成"第一行对象"、
          //   `info[0]` 恒为 undefined，文案退化成「该课程」却不报错 —— 这类静默错位只能靠实测发现。
          const info = await query(
            `SELECT c.name, x.week_day, x.section, x.capacity, x.enrolled
               FROM edu_class x JOIN edu_course c ON c.id = x.course_id
              WHERE x.id = ?`,
            [classId],
          );
          const i = info[0] || {};
          const WD = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
          const when = [WD[Number(i.week_day)] || '', i.section || ''].filter(Boolean).join(' ');
          return fail(
            42005,
            `「${i.name || '该课程'}」${when ? `（${when}）` : ''}名额已满（${i.enrolled ?? cls.enrolled}/${i.capacity ?? cls.capacity}），可关注退课释放的名额`,
          );
        }
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
