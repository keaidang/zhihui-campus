// /api/admin/students — 学生管理（班级维度名册：查询/导入/导出/调班）
// 权限：admin（全校）；counselor（仅本人带班：sys_class.counselor_id = 本人）
// GET  ?classId=&keyword=&page=&pageSize=  名册分页
//      ?export=csv                          全量导出（UTF-8 BOM）
// POST { action: 'import' | 'setProfile', ... }
import bcrypt from 'bcryptjs';
import { ok, fail, jsonError, readBody, preflight, clientIp } from '../../lib/http.js';
import { requireRoles, MANAGER_ROLES, ERR_FORBIDDEN, opLog } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';

export { preflight as onRequestOptions };

const PAGE_MAX = 100;
const BATCH_MAX = 500;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;
const DEFAULT_PWD = 'Zhihui@2026';

const bcryptHash = (pwd) => bcrypt.hash(pwd, 10);

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Date/字符串 → 'YYYY-MM-DD HH:mm:ss' */
const fmtDT = (v) => (v ? new Date(v).toLocaleString('sv-SE').replace('T', ' ').slice(0, 19) : '');
const fmtD = (v) => (v ? fmtDT(v).slice(0, 10) : '');

/** 辅导员数据范围：本人带班 id 列表；admin 返回 null（不过滤） */
async function scopeClassIds(roles, userId) {
  if (roles.includes('admin')) return null;
  const rows = await query('SELECT id FROM sys_class WHERE counselor_id = ?', [userId]);
  return rows.map((r) => r.id);
}

export async function onRequestGet(context) {
  try {
    const { roles, userId } = await requireRoles(context, MANAGER_ROLES);
    const myClasses = await scopeClassIds(roles, userId);
    if (myClasses && myClasses.length === 0) {
      return ok({ list: [], total: 0, classes: [] });
    }
    const url = new URL(context.request.url);
    const keyword = (url.searchParams.get('keyword') || '').trim().slice(0, 32);
    const classId = Number(url.searchParams.get('classId')) || null;
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const pageSize = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('pageSize') || 20)));

    const where = ["EXISTS (SELECT 1 FROM sys_user_role ur2 JOIN sys_role r ON r.id = ur2.role_id WHERE ur2.user_id = u.id AND r.code = 'student')"];
    const params = [];
    if (myClasses) {
      where.push(`u.class_id IN (${myClasses.map(() => '?').join(',')})`);
      params.push(...myClasses);
    }
    if (classId) {
      where.push('u.class_id = ?');
      params.push(classId);
    }
    if (keyword) {
      where.push('(u.username LIKE ? OR u.real_name LIKE ? OR u.user_no LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }
    const whereSql = where.join(' AND ');

    const selectSql = `SELECT u.id, u.username, u.real_name, u.user_no, u.status, u.valid_until,
              u.class_id, u.dept_id, u.created_at, u.last_login_at,
              c.name AS class_name, d.name AS dept_name
         FROM sys_user u
         LEFT JOIN sys_class c ON c.id = u.class_id
         LEFT JOIN sys_department d ON d.id = u.dept_id
        WHERE ${whereSql}
        ORDER BY u.class_id, u.user_no, u.username`;

    if (url.searchParams.get('export') === 'csv') {
      const rows = await query(`${selectSql} LIMIT 5000`, params);
      const header = ['学号', '姓名', '账号', '班级', '院系', '状态', '有效期', '最近登录'];
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push(
          [
            r.user_no || '',
            r.real_name || '',
            r.username,
            r.class_name || '未分班',
            r.dept_name || '',
            r.status === 1 ? '正常' : '禁用',
            r.valid_until ? fmtD(r.valid_until) : '长期',
            fmtDT(r.last_login_at),
          ].map(csvCell).join(','),
        );
      }
      return new Response(`\ufeff${lines.join('\r\n')}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="students-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM sys_user u WHERE ${whereSql}`, params);
    const rows = await query(`${selectSql} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    return ok({ list: rows, total: Number(total), page, pageSize });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { roles, userId: operatorId } = await requireRoles(context, MANAGER_ROLES);
    const myClasses = await scopeClassIds(roles, operatorId);
    const isAdmin = roles.includes('admin');
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || '');

    if (action === 'import') {
      const classId = Number(body.classId);
      if (!classId) return fail(41001, '请选择导入班级');
      if (myClasses && !myClasses.includes(classId)) throw ERR_FORBIDDEN('只能导入自己带班的班级');
      const cls = await query('SELECT id, dept_id, name FROM sys_class WHERE id = ?', [classId]);
      if (cls.length === 0) return fail(41001, '班级不存在');
      const rowsIn = Array.isArray(body.rows) ? body.rows.slice(0, BATCH_MAX) : [];
      if (rowsIn.length === 0) return fail(41001, '缺少学生数据');

      const defaultHash = await bcryptHash(DEFAULT_PWD);
      const created = [];
      const skipped = [];
      const seen = new Set();
      await withTransaction(async (conn) => {
        for (const r of rowsIn) {
          const username = String(r.username || '').trim();
          const realName = String(r.realName || '').trim().slice(0, 32);
          const userNo = String(r.userNo || '').trim().slice(0, 32);
          if (!USERNAME_RE.test(username) || !realName || seen.has(username)) {
            skipped.push({ username, reason: !USERNAME_RE.test(username) ? '用户名不合法' : !realName ? '缺姓名' : '批内重复' });
            continue;
          }
          const dup = await query('SELECT id FROM sys_user WHERE username = ?', [username]);
          if (dup.length > 0) {
            skipped.push({ username, reason: '已存在' });
            continue;
          }
          seen.add(username);
          const pwd = String(r.password || '').trim();
          const hash = pwd && pwd.length >= 8 && pwd.length <= 64 ? await bcryptHash(pwd) : defaultHash;
          const [ins] = await conn.query(
            `INSERT INTO sys_user (username, password_hash, real_name, user_no, dept_id, class_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [username, hash, realName, userNo, cls[0].dept_id, classId],
          );
          const [role] = await conn.query("SELECT id FROM sys_role WHERE code = 'student'");
          if (role[0]) {
            await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [ins.insertId, role[0].id]);
          }
          created.push(username);
        }
      });
      await opLog(operatorId, 'student.import', `class:${classId}`, `created=${created.length} skipped=${skipped.length}`, ip);
      return ok(
        { created, skipped, defaultPassword: created.length ? DEFAULT_PWD : undefined },
        `成功导入 ${created.length} 名学生${skipped.length ? `，跳过 ${skipped.length} 条` : ''}`,
      );
    }

    if (action === 'setProfile') {
      const targetId = Number(body.userId);
      if (!targetId) return fail(41001, '缺少 userId');
      const targets = await query('SELECT id, class_id, username FROM sys_user WHERE id = ?', [targetId]);
      if (targets.length === 0) return fail(41004, '学生不存在');
      const classId = body.classId ? Number(body.classId) : null;
      if (classId) {
        if (myClasses && !myClasses.includes(classId)) throw ERR_FORBIDDEN('只能调入自己带班的班级');
        const cls = await query('SELECT id FROM sys_class WHERE id = ?', [classId]);
        if (cls.length === 0) return fail(41001, '班级不存在');
      } else if (myClasses) {
        throw ERR_FORBIDDEN('辅导员不能把学生移出班级');
      }
      const userNo = String(body.userNo ?? '').trim().slice(0, 32);
      let deptId = null;
      if (classId) {
        const cls = await query('SELECT dept_id FROM sys_class WHERE id = ?', [classId]);
        deptId = cls[0]?.dept_id ?? null;
      }
      await query('UPDATE sys_user SET user_no = ?, class_id = ?, dept_id = ? WHERE id = ?', [userNo, classId, deptId, targetId]);
      await opLog(operatorId, 'student.setProfile', `user:${targetId}`, JSON.stringify({ userNo, classId }), ip);
      return ok({ userId: targetId }, '学生信息已更新');
    }

    return fail(41001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
