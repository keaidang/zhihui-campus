// /api/admin/courses — 管理员：课程库 + 排课管理
// GET    课程列表 + 教学班列表 + 可选教师列表
// POST   action: course.create | course.update | course.delete
//              | class.create  | class.update  | class.delete
//              | import.courses | import.schedule （CSV 文本导入）
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

const TERM_DEFAULT = '2026-2027-1';

/** 简易 CSV 解析（支持逗号/制表符分隔，自动跳过表头） */
function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim()));
  // 表头启发：首行含"编码/名称/课程"等字样则跳过
  const head = rows[0].join('');
  if (/编码|名称|课程|学分|学时|工号|教师|学期|周|节次|教室/.test(head)) rows.shift();
  return rows;
}

export async function onRequestGet(context) {
  try {
    await requireRoles(context, ['admin']);
    const courses = await query(
      `SELECT ec.id, ec.code, ec.name, ec.credit, ec.hours, ec.dept_id, ec.status,
              d.name AS dept_name,
              (SELECT COUNT(*) FROM edu_class x WHERE x.course_id = ec.id) AS class_count
         FROM edu_course ec
         LEFT JOIN sys_department d ON d.id = ec.dept_id
        ORDER BY ec.code`,
    );
    const classes = await query(
      `SELECT x.id, x.course_id, x.teacher_id, x.term, x.capacity, x.enrolled,
              x.week_day, x.section, x.classroom, x.status,
              c.name AS course_name, c.code AS course_code,
              u.real_name AS teacher_name, u.user_no AS teacher_no
         FROM edu_class x
         JOIN edu_course c ON c.id = x.course_id
         JOIN sys_user u ON u.id = x.teacher_id
        ORDER BY x.week_day, x.section, c.code`,
    );
    const teachers = await query(
      `SELECT DISTINCT u.id, u.user_no, u.real_name, d.name AS dept_name
         FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id = u.id
         JOIN sys_role r ON r.id = ur.role_id
         LEFT JOIN sys_department d ON d.id = u.dept_id
        WHERE r.code = 'teacher' AND u.status = 1
        ORDER BY u.user_no`,
    );
    // 开课院系下拉：仅教学院系（行政部门不开课）
    const depts = await query("SELECT id, name FROM sys_department WHERE dept_type = 'college' ORDER BY id");
    return ok({ courses, classes, teachers, depts });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId: operatorId } = await requireRoles(context, ['admin']);
    const ip = clientIp(context.request);
    const body = await readBody(context.request, 256 * 1024);
    const action = String(body.action || '');

    // ---------- 课程库 ----------
    if (action === 'course.create') {
      const code = String(body.code || '').trim().slice(0, 32);
      const name = String(body.name || '').trim().slice(0, 128);
      if (!code || !name) return fail(42100, '课程编码与名称必填');
      const dup = await query('SELECT id FROM edu_course WHERE code = ?', [code]);
      if (dup.length) return fail(42101, `课程编码 ${code} 已存在`);
      const r = await query(
        'INSERT INTO edu_course (code, name, credit, hours, dept_id, status) VALUES (?, ?, ?, ?, ?, ?)',
        [code, name, Number(body.credit) || 2.0, Number(body.hours) || 32, body.deptId ? Number(body.deptId) : null, body.status === 0 ? 0 : 1],
      );
      await opLog(operatorId, 'course.create', code, name, ip);
      return ok({ id: r.insertId });
    }

    if (action === 'course.update') {
      const id = Number(body.courseId);
      if (!id) return fail(42100, '缺少 courseId');
      const sets = [];
      const params = [];
      if (body.name != null) { sets.push('name = ?'); params.push(String(body.name).trim().slice(0, 128)); }
      if (body.credit != null) { sets.push('credit = ?'); params.push(Number(body.credit)); }
      if (body.hours != null) { sets.push('hours = ?'); params.push(Number(body.hours)); }
      if (body.deptId != null) { sets.push('dept_id = ?'); params.push(body.deptId ? Number(body.deptId) : null); }
      if (body.status != null) { sets.push('status = ?'); params.push(Number(body.status) ? 1 : 0); }
      if (!sets.length) return fail(42100, '无可更新字段');
      params.push(id);
      await query(`UPDATE edu_course SET ${sets.join(', ')} WHERE id = ?`, params);
      await opLog(operatorId, 'course.update', String(id), sets.join(','), ip);
      return ok();
    }

    if (action === 'course.delete') {
      const id = Number(body.courseId);
      if (!id) return fail(42100, '缺少 courseId');
      const used = await query('SELECT COUNT(*) n FROM edu_class WHERE course_id = ?', [id]);
      if (Number(used[0].n) > 0) return fail(42102, '该课程已开设教学班，请先删除对应排课');
      await query('DELETE FROM edu_course WHERE id = ?', [id]);
      await opLog(operatorId, 'course.delete', String(id), '', ip);
      return ok();
    }

    // ---------- 排课（教学班） ----------
    if (action === 'class.create') {
      const courseId = Number(body.courseId);
      const teacherId = Number(body.teacherId);
      const weekDay = Number(body.weekDay);
      const section = String(body.section || '').trim().slice(0, 16);
      if (!courseId || !teacherId || !(weekDay >= 1 && weekDay <= 7) || !section) {
        return fail(42110, '课程、教师、周几(1-7)、节次均为必填');
      }
      const dup = await query(
        'SELECT id FROM edu_class WHERE course_id = ? AND teacher_id = ? AND term = ? AND week_day = ? AND section = ?',
        [courseId, teacherId, body.term || TERM_DEFAULT, weekDay, section],
      );
      if (dup.length) return fail(42111, '同一课程、教师、时段的排课已存在');
      const r = await query(
        'INSERT INTO edu_class (course_id, teacher_id, term, capacity, week_day, section, classroom, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [courseId, teacherId, body.term || TERM_DEFAULT, Number(body.capacity) || 60, weekDay, section, String(body.classroom || '').trim().slice(0, 64), body.status === 0 ? 0 : 1],
      );
      await opLog(operatorId, 'class.create', String(r.insertId), `${courseId}@${teacherId}`, ip);
      return ok({ id: r.insertId });
    }

    if (action === 'class.update') {
      const id = Number(body.classId);
      if (!id) return fail(42110, '缺少 classId');
      const sets = [];
      const params = [];
      if (body.teacherId != null) { sets.push('teacher_id = ?'); params.push(Number(body.teacherId)); }
      if (body.term) { sets.push('term = ?'); params.push(String(body.term).trim().slice(0, 16)); }
      if (body.capacity != null) { sets.push('capacity = ?'); params.push(Number(body.capacity)); }
      if (body.weekDay != null) { sets.push('week_day = ?'); params.push(Number(body.weekDay)); }
      if (body.section) { sets.push('section = ?'); params.push(String(body.section).trim().slice(0, 16)); }
      if (body.classroom != null) { sets.push('classroom = ?'); params.push(String(body.classroom).trim().slice(0, 64)); }
      if (body.status != null) { sets.push('status = ?'); params.push(Number(body.status) ? 1 : 0); }
      if (!sets.length) return fail(42110, '无可更新字段');
      params.push(id);
      await query(`UPDATE edu_class SET ${sets.join(', ')} WHERE id = ?`, params);
      await opLog(operatorId, 'class.update', String(id), sets.join(','), ip);
      return ok();
    }

    if (action === 'class.delete') {
      const id = Number(body.classId);
      if (!id) return fail(42110, '缺少 classId');
      const used = await query('SELECT COUNT(*) n FROM edu_elect WHERE class_id = ? AND status IN (1, 2)', [id]);
      if (Number(used[0].n) > 0) return fail(42112, `该教学班已有 ${used[0].n} 名学生选课，不能删除（可改为停选）`);
      await query('DELETE FROM edu_class WHERE id = ?', [id]);
      await opLog(operatorId, 'class.delete', String(id), '', ip);
      return ok();
    }

    // ---------- 批量导入 ----------
    if (action === 'import.courses') {
      const rows = parseCsv(body.csv);
      if (!rows.length) return fail(42120, '未解析到有效数据行');
      let created = 0;
      let updated = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const [code, name, credit, hours, deptId] = rows[i];
        if (!code || !name) { errors.push(`第${i + 1}行：编码/名称缺失`); continue; }
        try {
          const exist = await query('SELECT id FROM edu_course WHERE code = ?', [code]);
          if (exist.length) {
            await query('UPDATE edu_course SET name = ?, credit = ?, hours = ? WHERE id = ?', [
              name, Number(credit) || 2.0, Number(hours) || 32, exist[0].id,
            ]);
            updated++;
          } else {
            await query('INSERT INTO edu_course (code, name, credit, hours, dept_id) VALUES (?, ?, ?, ?, ?)', [
              code, name, Number(credit) || 2.0, Number(hours) || 32, deptId ? Number(deptId) : null,
            ]);
            created++;
          }
        } catch (e) {
          errors.push(`第${i + 1}行：${e.message?.slice(0, 80)}`);
        }
      }
      await opLog(operatorId, 'course.import', 'batch', `created=${created} updated=${updated} errors=${errors.length}`, ip);
      return ok({ created, updated, errors });
    }

    if (action === 'import.schedule') {
      // 列：课程编码,教师工号,学期,周几,节次,教室,容量
      const rows = parseCsv(body.csv);
      if (!rows.length) return fail(42120, '未解析到有效数据行');
      let created = 0;
      const errors = [];
      for (let i = 0; i < rows.length; i++) {
        const [courseCode, teacherNo, term, weekDay, section, classroom, capacity] = rows[i];
        if (!courseCode || !teacherNo || !weekDay || !section) {
          errors.push(`第${i + 1}行：课程编码/教师工号/周几/节次缺失`); continue;
        }
        const c = await query('SELECT id FROM edu_course WHERE code = ?', [courseCode]);
        if (!c.length) { errors.push(`第${i + 1}行：课程 ${courseCode} 不存在（请先导入课程）`); continue; }
        const t = await query(
          `SELECT u.id FROM sys_user u
             JOIN sys_user_role ur ON ur.user_id = u.id
             JOIN sys_role r ON r.id = ur.role_id
            WHERE u.user_no = ? AND r.code = 'teacher' AND u.status = 1`,
          [teacherNo],
        );
        if (!t.length) { errors.push(`第${i + 1}行：教师工号 ${teacherNo} 不存在`); continue; }
        const day = Number(weekDay);
        if (!(day >= 1 && day <= 7)) { errors.push(`第${i + 1}行：周几需为 1-7`); continue; }
        try {
          const sec = /^\d+$/.test(section) ? `${section}-${Number(section) + 1}节` : section;
          const dup = await query(
            'SELECT id FROM edu_class WHERE course_id = ? AND teacher_id = ? AND term = ? AND week_day = ? AND section = ?',
            [c[0].id, t[0].id, term || TERM_DEFAULT, day, sec],
          );
          if (dup.length) { errors.push(`第${i + 1}行：该时段排课已存在，跳过`); continue; }
          await query(
            'INSERT INTO edu_class (course_id, teacher_id, term, capacity, week_day, section, classroom) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [c[0].id, t[0].id, term || TERM_DEFAULT, Number(capacity) || 60, day, sec, classroom || ''],
          );
          created++;
        } catch (e) {
          errors.push(`第${i + 1}行：${e.message?.slice(0, 80)}`);
        }
      }
      await opLog(operatorId, 'schedule.import', 'batch', `created=${created} errors=${errors.length}`, ip);
      return ok({ created, errors });
    }

    return fail(42199, `未知操作：${action}`);
  } catch (e) {
    return jsonError(e);
  }
}
