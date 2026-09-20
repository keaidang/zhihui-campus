// /api/admin/users — 账号管理（列表/搜索/改状态/分配角色/设归属/有效期/创建/删除/导入导出）
// 权限：admin（全校）、counselor（仅本院，且不能改角色/删除/创建）
// GET  分页列表  ?keyword=&role=&deptId=&status=&page=1&pageSize=20
//                ?export=csv → 全量导出（UTF-8 BOM，Excel 兼容）
// POST 单条操作  { userId, action: setStatus | setRoles | setProfile | setValidUntil | delete | create | batchCreate | batchDelete, value }
import bcrypt from 'bcryptjs';
import { ok, fail, jsonError, readBody, preflight, clientIp } from '../../lib/http.js';
import { requireRoles, MANAGER_ROLES, dataScope, ERR_FORBIDDEN, opLog } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';

export { preflight as onRequestOptions };

const PAGE_MAX = 100;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;
const DEFAULT_PWD = 'Zhihui@2026'; // 批量导入未指定密码时的统一初始密码
const BATCH_MAX = 500;

/** CSV 单元格转义：逗号/引号/换行 */
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 有效期入参 → Date（'YYYY-MM-DD' 视为当天 23:59:59）或 null */
function parseValidUntil(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new Error('VALID_FORMAT');
  const d = new Date(`${s.slice(0, 10)} 23:59:59`);
  return isNaN(d.getTime()) ? null : d;
}

/** Date/字符串 → 'YYYY-MM-DD HH:mm:ss'（sv-SE locale 恰好是这个格式） */
const fmtDT = (v) => (v ? new Date(v).toLocaleString('sv-SE').replace('T', ' ').slice(0, 19) : '');
const fmtD = (v) => (v ? fmtDT(v).slice(0, 10) : '');

export async function onRequestGet(context) {
  try {
    const { roles, deptId } = await requireRoles(context, MANAGER_ROLES);
    const scope = dataScope(roles, deptId);
    const url = new URL(context.request.url);
    const keyword = (url.searchParams.get('keyword') || '').trim().slice(0, 32);
    const role = (url.searchParams.get('role') || '').trim().slice(0, 32);
    const status = url.searchParams.get('status');
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const pageSize = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('pageSize') || 20)));

    const where = ['1 = 1'];
    const params = [];
    if (scope.type === 'dept') {
      where.push('u.dept_id = ?');
      params.push(scope.deptId);
    }
    if (keyword) {
      where.push('(u.username LIKE ? OR u.real_name LIKE ? OR u.user_no LIKE ? OR u.campus_email LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like, like);
    }
    if (status === '0' || status === '1') {
      where.push('u.status = ?');
      params.push(Number(status));
    }
    if (role) {
      where.push('EXISTS (SELECT 1 FROM sys_user_role x JOIN sys_role r2 ON r2.id = x.role_id WHERE x.user_id = u.id AND r2.code = ?)');
      params.push(role);
    }
    // 僵尸用户筛选：never=从未登录；30/60/90=N 天未登录（含从未登录）
    const lastLogin = (url.searchParams.get('lastLogin') || '').trim();
    if (lastLogin === 'never') {
      where.push('u.last_login_at IS NULL');
    } else if (['30', '60', '90'].includes(lastLogin)) {
      where.push(`(u.last_login_at IS NULL OR u.last_login_at < NOW() - INTERVAL ${Number(lastLogin)} DAY)`);
    }
    const whereSql = where.join(' AND ');

    const selectSql = `SELECT u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id, u.class_id,
              u.valid_until, u.created_at, u.last_login_at,
              u.campus_email, u.mail_enabled, u.mail_mailbox_id,
              d.name AS dept_name, c.name AS class_name,
              GROUP_CONCAT(r.code) AS role_codes
         FROM sys_user u
         LEFT JOIN sys_department d ON d.id = u.dept_id
         LEFT JOIN sys_class c ON c.id = u.class_id
         LEFT JOIN sys_user_role ur ON ur.user_id = u.id
         LEFT JOIN sys_role r ON r.id = ur.role_id
        WHERE ${whereSql}
        GROUP BY u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id, u.class_id,
                 u.valid_until, u.created_at, u.last_login_at, d.name, c.name
        ORDER BY u.id DESC`;

    // CSV 导出：全量（上限 5000），UTF-8 BOM 保证 Excel 中文不乱码
    if (url.searchParams.get('export') === 'csv') {
      const rows = await query(`${selectSql} LIMIT 5000`, params);
      const header = ['账号', '姓名', '角色', '学号/工号', '院系', '班级', '状态', '有效期', '注册时间', '最近登录'];
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push(
          [
            r.username,
            r.real_name,
            r.role_codes ? String(r.role_codes).split(',').join('|') : '',
            r.user_no || '',
            r.dept_name || '',
            r.class_name || '',
            r.status === 1 ? '正常' : '禁用',
            r.valid_until ? fmtD(r.valid_until) : '长期',
            fmtDT(r.created_at),
            fmtDT(r.last_login_at),
          ].map(csvCell).join(','),
        );
      }
      return new Response(`\ufeff${lines.join('\r\n')}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM sys_user u WHERE ${whereSql}`, params);
    const rows = await query(`${selectSql} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);

    return ok({
      list: rows.map((r) => ({ ...r, roles: r.role_codes ? String(r.role_codes).split(',') : [] })),
      total: Number(total),
      page,
      pageSize,
      scope,
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { roles, userId: operatorId } = await requireRoles(context, MANAGER_ROLES);
    const scope = dataScope(roles, null);
    const isAdmin = roles.includes('admin');
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const targetId = Number(body.userId);
    const action = String(body.action || '');
    const value = body.value;

    if (!targetId) {
      // ---- 无 userId 的管理动作：创建类（admin 独占） ----
      if (!isAdmin) throw ERR_FORBIDDEN('仅超级管理员可创建/删除账号');

      if (action === 'create' || action === 'batchCreate') {
        const rowsIn =
          action === 'batchCreate'
            ? Array.isArray(body.rows)
              ? body.rows.slice(0, BATCH_MAX)
              : []
            : [body];
        if (rowsIn.length === 0) return fail(41001, '缺少账号数据');
        // 默认密码统一哈希一次，避免批量 bcrypt 拖垮函数时长
        const defaultHash = await bcrypt.hash(DEFAULT_PWD, 10);
        const created = [];
        const skipped = [];
        const seen = new Set();
        let customHashCache = { pwd: null, hash: null };
        const hashOf = async (pwd) => {
          const p = String(pwd || '').trim();
          if (!p) return { pwd: DEFAULT_PWD, hash: defaultHash };
          if (p.length < 8 || p.length > 64) throw new Error('PWD_FORMAT');
          if (customHashCache.pwd === p) return { pwd: p, hash: customHashCache.hash };
          const h = await bcrypt.hash(p, 10);
          customHashCache = { pwd: p, hash: h };
          return { pwd: p, hash: h };
        };
        try {
          await withTransaction(async (conn) => {
            for (const r of rowsIn) {
              const username = String(r.username || '').trim();
              const realName = String(r.realName || '').trim().slice(0, 32);
              const validUntil = parseValidUntil(r.validUntil);
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
              const { pwd, hash } = await hashOf(r.password);
              const deptId = r.deptId ? Number(r.deptId) : null;
              const classId = r.classId ? Number(r.classId) : null;
              const userNo = String(r.userNo || '').trim().slice(0, 32);
              const [ins] = await conn.query(
                `INSERT INTO sys_user (username, password_hash, real_name, user_no, dept_id, class_id, valid_until)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [username, hash, realName, userNo, deptId, classId, validUntil],
              );
              const codes = Array.isArray(r.roles) && r.roles.length ? r.roles.map(String) : ['student'];
              const roleRows = await query(
                `SELECT id FROM sys_role WHERE code IN (${codes.map(() => '?').join(',')})`,
                codes,
              );
              for (const rr of roleRows) {
                await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [ins.insertId, rr.id]);
              }
              created.push(username);
            }
          });
        } catch (e) {
          if (e.message === 'PWD_FORMAT') return fail(41001, '密码长度须为 8~64 位');
          if (e.message === 'VALID_FORMAT') return fail(41001, '有效期格式应为 YYYY-MM-DD');
          throw e;
        }
        await opLog(operatorId, action === 'create' ? 'user.create' : 'user.batchCreate', 'batch', `created=${created.length} skipped=${skipped.length}`, ip);
        return ok(
          { created, skipped, defaultPassword: created.length ? DEFAULT_PWD : undefined },
          `成功创建 ${created.length} 个账号${skipped.length ? `，跳过 ${skipped.length} 个` : ''}`,
        );
      }

      if (action === 'batchDelete') {
        const ids = Array.isArray(body.userIds) ? [...new Set(body.userIds.map(Number).filter(Boolean))] : [];
        if (ids.length === 0) return fail(41001, '缺少 userIds');
        if (ids.length > BATCH_MAX) return fail(41001, `单次最多删除 ${BATCH_MAX} 个`);
        if (ids.includes(operatorId)) return fail(41005, '不能删除自己的账号');
        const placeholders = ids.map(() => '?').join(',');
        const admins = await query(
          `SELECT DISTINCT ur.user_id FROM sys_user_role ur
             JOIN sys_role r ON r.id = ur.role_id
            WHERE r.code = 'admin' AND ur.user_id IN (${placeholders})`,
          ids,
        );
        const adminIds = new Set(admins.map((a) => a.user_id));
        const deletable = ids.filter((id) => !adminIds.has(id));
        const protectedCount = ids.length - deletable.length;
        let deleted = 0;
        if (deletable.length) {
          const ph2 = deletable.map(() => '?').join(',');
          await withTransaction(async (conn) => {
            await conn.query(`DELETE FROM sys_user_role WHERE user_id IN (${ph2})`, deletable);
            await conn.query(`DELETE FROM sys_refresh_token WHERE user_id IN (${ph2})`, deletable);
            const [res] = await conn.query(`DELETE FROM sys_user WHERE id IN (${ph2})`, deletable);
            deleted = res.affectedRows;
          });
        }
        await opLog(operatorId, 'user.batchDelete', 'batch', `deleted=${deleted} protected=${protectedCount}`, ip);
        return ok(
          { deleted, protected: protectedCount },
          `已删除 ${deleted} 个账号${protectedCount ? `，跳过管理员/保护账号 ${protectedCount} 个` : ''}`,
        );
      }

      return fail(41001, '缺少 userId');
    }

    const targets = await query('SELECT id, username, dept_id FROM sys_user WHERE id = ?', [targetId]);
    if (targets.length === 0) return fail(41004, '用户不存在');
    const target = targets[0];

    // 辅导员只能操作本院用户
    if (!isAdmin) {
      const my = await query('SELECT dept_id FROM sys_user WHERE id = ?', [operatorId]);
      if (!my[0]?.dept_id || my[0].dept_id !== target.dept_id) throw ERR_FORBIDDEN('只能管理本院用户');
    }

    if (action === 'setStatus') {
      const next = Number(value) === 1 ? 1 : 0;
      if (targetId === operatorId) return fail(41005, '不能修改自己的账号状态');
      await query('UPDATE sys_user SET status = ? WHERE id = ?', [next, targetId]);
      await opLog(operatorId, 'user.setStatus', `user:${targetId}`, String(next), ip);
      return ok({ userId: targetId, status: next }, next === 1 ? '账号已启用' : '账号已禁用');
    }

    if (action === 'setProfile') {
      const userNo = String(value?.userNo ?? '').trim().slice(0, 32);
      // 越权修复：院系归属只有超管能改；辅导员只能补学号/班级，
      // 否则可把用户 dept_id 置空使其逃出"本院"数据范围（scope 失效）
      let deptId = target.dept_id;
      if (isAdmin) deptId = value?.deptId ? Number(value.deptId) : null;
      const classId = value?.classId ? Number(value.classId) : null;
      if (classId) {
        const cls = await query('SELECT id, dept_id FROM sys_class WHERE id = ?', [classId]);
        if (cls.length === 0) return fail(41001, '班级不存在');
        if (deptId && cls[0].dept_id !== deptId) return fail(41001, '班级不属于所选院系');
      }
      await query('UPDATE sys_user SET user_no = ?, dept_id = ?, class_id = ? WHERE id = ?', [
        userNo,
        deptId,
        classId,
        targetId,
      ]);
      await opLog(operatorId, 'user.setProfile', `user:${targetId}`, JSON.stringify({ userNo, deptId, classId }), ip);
      return ok({ userId: targetId }, '归属信息已更新');
    }

    if (action === 'setValidUntil') {
      if (!isAdmin) throw ERR_FORBIDDEN('仅超级管理员可设置账号有效期');
      let validUntil = null;
      try {
        validUntil = parseValidUntil(value);
      } catch {
        return fail(41001, '有效期格式应为 YYYY-MM-DD');
      }
      await query('UPDATE sys_user SET valid_until = ? WHERE id = ?', [validUntil, targetId]);
      await opLog(operatorId, 'user.setValidUntil', `user:${targetId}`, validUntil ? String(validUntil).slice(0, 10) : 'long-term', ip);
      return ok({ userId: targetId, validUntil }, validUntil ? '有效期已更新' : '已设为长期有效');
    }

    if (action === 'resetPassword') {
      if (!isAdmin) throw ERR_FORBIDDEN('仅超级管理员可重置登录密码');
      if (target.username === 'admin' && targetId !== operatorId) {
        return fail(41009, '不能重置其他管理员的主账号密码');
      }
      let pwd = String(body.password || '').trim();
      if (!pwd) {
        pwd = `Zh${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 90 + 10)}`;
      }
      if (pwd.length < 8) return fail(41008, '密码至少 8 位');
      const hash = await bcrypt.hash(pwd, 10);
      await query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [hash, targetId]);
      await query('DELETE FROM sys_refresh_token WHERE user_id = ?', [targetId]);
      await opLog(operatorId, 'user.resetPassword', `user:${targetId}`, target.username, ip);
      return ok({ userId: targetId, password: pwd }, `密码已重置：${pwd}（请立即告知用户）`);
    }

    if (action === 'delete') {
      if (!isAdmin) throw ERR_FORBIDDEN('仅超级管理员可删除账号');
      if (targetId === operatorId) return fail(41005, '不能删除自己的账号');
      const isAdminTarget = await query(
        `SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
          WHERE ur.user_id = ? AND r.code = 'admin'`,
        [targetId],
      );
      if (isAdminTarget.length > 0) return fail(41007, '不能删除管理员账号，请先移除其管理员角色');
      await withTransaction(async (conn) => {
        await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [targetId]);
        await conn.query('DELETE FROM sys_refresh_token WHERE user_id = ?', [targetId]);
        await conn.query('DELETE FROM sys_user WHERE id = ?', [targetId]);
      });
      await opLog(operatorId, 'user.delete', `user:${targetId}`, target.username, ip);
      return ok({ userId: targetId }, `已删除账号 ${target.username}`);
    }

    if (action === 'setRoles') {
      if (!isAdmin) throw ERR_FORBIDDEN('仅超级管理员可分配角色');
      const codes = Array.isArray(value) ? value.map((c) => String(c)).slice(0, 10) : [];
      if (codes.length === 0) return fail(41001, '至少保留一个角色');
      const roleRows = await query(
        `SELECT id, code FROM sys_role WHERE code IN (${codes.map(() => '?').join(',')})`,
        codes,
      );
      if (roleRows.length !== codes.length) return fail(41001, '存在无效角色编码');
      // 不能把自己的 admin 角色摘掉（防自锁）
      if (targetId === operatorId && !codes.includes('admin')) {
        return fail(41006, '不能移除自己的超级管理员角色');
      }
      await withTransaction(async (conn) => {
        await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [targetId]);
        for (const r of roleRows) {
          await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [
            targetId,
            r.id,
          ]);
        }
      });
      await opLog(operatorId, 'user.setRoles', `user:${targetId}`, codes.join(','), ip);
      return ok({ userId: targetId, roles: codes }, '角色已更新（重新登录后菜单生效）');
    }

    return fail(41001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
