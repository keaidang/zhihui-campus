// lib/services/users.js — 账号服务（从 api/admin/users.js 抽出，行为保持逐字节一致）
//
// 调用方：api/admin/users.js（人工） + lib/ai-actions.js（AI 对话触发禁用/启用/查询）
//
// 权限模型（沿用原实现，不要"顺手放宽"）：
//   · 入口门槛 MANAGER_ROLES = admin | counselor
//   · 写操作**逐分支**再校验：isAdmin 独占 创建/批量删/删/改角色/改有效期/重置密码
//   · 辅导员只能操作**本院**用户，且不能改角色/删除/创建
//   · 防自锁：任何人都不能禁自己/删自己/摘掉自己的 admin 角色；不能重置其他 admin 主账号密码
import bcrypt from 'bcryptjs';
import { HttpError, dataScope, opLog } from '../guard.js';
import { query, withTransaction } from '../db.js';
import { auditDetail, isAdmin } from './_actor.js';

const PAGE_MAX = 100;
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;
const DEFAULT_PWD = 'Zhihui@2026'; // 批量导入未指定密码时的统一初始密码
const BATCH_MAX = 500;
const FIND_MAX = 200; // AI/预览用的候选清单上限

/** CSV 单元格转义：逗号/引号/换行 */
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * 有效期入参 → 'YYYY-MM-DD HH:mm:ss' 字符串（'YYYY-MM-DD' 视为北京当天 23:59:59）或 null
 * ★ 库内时间统一存 UTC，用户输入的是北京日历日：北京 23:59:59 = UTC 15:59:59，
 *   直接返回字符串避免 Date 对象二次时区解读（铁律 #25）
 */
export function parseValidUntil(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new HttpError(41001, '有效期格式应为 YYYY-MM-DD');
  const d = new Date(`${s.slice(0, 10)}T23:59:59Z`);
  if (isNaN(d.getTime())) return null;
  return `${s.slice(0, 10)} 15:59:59`;
}

/** Date/字符串 → 'YYYY-MM-DD HH:mm:ss'（北京时间展示，导出 CSV 用） */
const fmtDT = (v) =>
  v ? new Date(v).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ').slice(0, 19) : '';
const fmtD = (v) => (v ? fmtDT(v).slice(0, 10) : '');

/** 解析查询条件（列表与导出共用，避免两处漂移） */
function buildWhere(actor, { keyword = '', role = '', status = '', lastLogin = '' } = {}) {
  const scope = dataScope(actor.roles, actor.deptId);
  const where = ['1 = 1'];
  const params = [];
  if (scope.type === 'dept') {
    where.push('u.dept_id = ?');
    params.push(scope.deptId);
  } else if (scope.type !== 'all') {
    // ★★ 兜底：与 services/leave.js 同因（2026-10-10 体检）。
    //   self 时若不限条件 = 全校账号可见（实测直接调 service 得到 total=490）。
    //   虽然当前的 HTTP 入口有 MANAGER_ROLES 门槛挡住教师/学生，
    //   但"服务层依赖入口把关"是脆弱的 —— AI、脚本、将来的新接口都可能直接调用。
    //   退化为"仅本人"，与 dataScope 的 self 语义一致。
    where.push('u.id = ?');
    params.push(actor.userId);
  }
  const kw = String(keyword).trim().slice(0, 32);
  if (kw) {
    where.push('(u.username LIKE ? OR u.real_name LIKE ? OR u.user_no LIKE ? OR u.campus_email LIKE ?)');
    const like = `%${kw}%`;
    params.push(like, like, like, like);
  }
  if (status === '0' || status === '1') {
    where.push('u.status = ?');
    params.push(Number(status));
  }
  const r = String(role).trim().slice(0, 32);
  if (r) {
    where.push('EXISTS (SELECT 1 FROM sys_user_role x JOIN sys_role r2 ON r2.id = x.role_id WHERE x.user_id = u.id AND r2.code = ?)');
    params.push(r);
  }
  // 僵尸用户筛选：never=从未登录；30/60/90=N 天未登录（含从未登录）
  const ll = String(lastLogin).trim();
  if (ll === 'never') {
    where.push('u.last_login_at IS NULL');
  } else if (['30', '60', '90'].includes(ll)) {
    where.push(`(u.last_login_at IS NULL OR u.last_login_at < NOW() - INTERVAL ${Number(ll)} DAY)`);
  }
  return { whereSql: where.join(' AND '), params, scope };
}

const SELECT_SQL = `SELECT u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id, u.class_id,
            u.valid_until, u.created_at, u.last_login_at,
            u.campus_email, u.mail_enabled, u.mail_mailbox_id,
            d.name AS dept_name, c.name AS class_name,
            GROUP_CONCAT(r.code) AS role_codes
       FROM sys_user u
       LEFT JOIN sys_department d ON d.id = u.dept_id
       LEFT JOIN sys_class c ON c.id = u.class_id
       LEFT JOIN sys_user_role ur ON ur.user_id = u.id
       LEFT JOIN sys_role r ON r.id = ur.role_id
      WHERE `;

const GROUP_BY = ` GROUP BY u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id, u.class_id,
               u.valid_until, u.created_at, u.last_login_at, d.name, c.name
      ORDER BY u.id DESC`;

/** 账号分页列表 */
export async function listUsers(actor, params = {}) {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(PAGE_MAX, Math.max(1, Number(params.pageSize) || 20));
  const { whereSql, params: ps, scope } = buildWhere(actor, params);

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM sys_user u WHERE ${whereSql}`, ps);
  const rows = await query(`${SELECT_SQL}${whereSql}${GROUP_BY} LIMIT ? OFFSET ?`, [
    ...ps,
    pageSize,
    (page - 1) * pageSize,
  ]);

  return {
    data: {
      list: rows.map((r) => ({ ...r, roles: r.role_codes ? String(r.role_codes).split(',') : [] })),
      total: Number(total),
      page,
      pageSize,
      scope,
    },
    message: 'ok',
  };
}

/** 账号全量导出（CSV 文本；handler 负责包成下载响应） */
export async function exportUsersCsv(actor) {
  const { whereSql, params } = buildWhere(actor, {});
  const rows = await query(`${SELECT_SQL}${whereSql}${GROUP_BY} LIMIT 5000`, params);
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
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // UTF-8 BOM：保证 Excel 打开中文不乱码
  return { data: { csv: `\ufeff${lines.join('\r\n')}` }, message: 'ok' };
}

/**
 * ★ 统计账号条数（与 findUsers 共用同一套 where → 数据范围完全一致）
 *
 * 为什么必须单独写一个 COUNT 函数：
 *   findUsers 返回的是**分页后的数组**，没有 total 字段。曾想用
 *   `findUsers(limit:1).total` 取总数 —— 那是想当然，它返回 1 条数组、
 *   `.total` 是 undefined，于是计数结果恒为 NaN。
 *   而且"拉明细再数长度"在超过上限时必然错（FIND_MAX 截断）。
 *   复用 buildWhere 保证：辅导员查到的个数与他查到的列表来自同一范围。
 *
 * @returns {Promise<number>}
 */
export async function countUsers(actor, filters = {}) {
  const { whereSql, params } = buildWhere(actor, { ...filters, page: 1 });
  const rows = await query(
    `SELECT COUNT(*) AS n
       FROM sys_user u
       LEFT JOIN sys_department d ON d.id = u.dept_id
       LEFT JOIN sys_user_role ur ON ur.user_id = u.id
       LEFT JOIN sys_role r ON r.id = ur.role_id
      WHERE ${whereSql}`,
    params,
  );
  return Number(rows[0]?.n || 0);
}

/**
 * ★ 供 AI（C5）与预览用的候选查询：只读、受限、不带分页
 * 与 listUsers 共用同一套 where 构造（含数据范围），因此**辅导员查不到外院的人**。
 * @returns {Promise<object[]>} 精简字段（AI 只需这些就能生成影响清单）
 */
export async function findUsers(actor, filters = {}) {
  const { whereSql, params } = buildWhere(actor, { ...filters, page: 1 });
  const limit = Math.min(FIND_MAX, Math.max(1, Number(filters.limit) || 50));
  const rows = await query(
    `SELECT u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id,
            d.name AS dept_name,
            GROUP_CONCAT(r.code) AS role_codes
       FROM sys_user u
       LEFT JOIN sys_department d ON d.id = u.dept_id
       LEFT JOIN sys_user_role ur ON ur.user_id = u.id
       LEFT JOIN sys_role r ON r.id = ur.role_id
      WHERE ${whereSql}
      GROUP BY u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id, d.name
      ORDER BY u.id ASC
      LIMIT ?`,
    [...params, limit],
  );
  return rows.map((r) => ({ ...r, roles: r.role_codes ? String(r.role_codes).split(',') : [] }));
}

/** 取目标用户并做"辅导员只能管本院"的校验（写操作共用） */
async function loadTarget(actor, targetId) {
  const rows = await query('SELECT id, username, dept_id, status FROM sys_user WHERE id = ?', [targetId]);
  if (rows.length === 0) throw new HttpError(41004, '用户不存在');
  const target = rows[0];
  if (!isAdmin(actor)) {
    const my = await query('SELECT dept_id FROM sys_user WHERE id = ?', [actor.userId]);
    if (!my[0]?.dept_id || my[0].dept_id !== target.dept_id) throw new HttpError(40301, '只能管理本院用户', 403);
  }
  return target;
}

/**
 * 批量创建账号（admin 独占）
 * 批量导入**不回传明文密码**（避免密码经响应体/日志扩散）；仅 create 单条时回传默认密码提示。
 */
export async function createUsers(actor, body = {}, { batch = false } = {}) {
  if (!isAdmin(actor)) throw new HttpError(40301, '仅超级管理员可创建/删除账号', 403);
  const rowsIn = batch ? (Array.isArray(body.rows) ? body.rows.slice(0, BATCH_MAX) : []) : [body];
  if (rowsIn.length === 0) throw new HttpError(41001, '缺少账号数据');

  // 默认密码统一哈希一次，避免批量 bcrypt 拖垮函数时长
  const defaultHash = await bcrypt.hash(DEFAULT_PWD, 10);
  const created = [];
  const skipped = [];
  const seen = new Set();
  let customHashCache = { pwd: null, hash: null };
  const hashOf = async (pwd) => {
    const p = String(pwd || '').trim();
    if (!p) return { pwd: DEFAULT_PWD, hash: defaultHash };
    if (p.length < 8 || p.length > 64) throw new HttpError(41001, '密码长度须为 8~64 位');
    if (customHashCache.pwd === p) return { pwd: p, hash: customHashCache.hash };
    const h = await bcrypt.hash(p, 10);
    customHashCache = { pwd: p, hash: h };
    return { pwd: p, hash: h };
  };

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
      const { hash } = await hashOf(r.password);
      const deptId = r.deptId ? Number(r.deptId) : null;
      const classId = r.classId ? Number(r.classId) : null;
      const userNo = String(r.userNo || '').trim().slice(0, 32);
      const [ins] = await conn.query(
        `INSERT INTO sys_user (username, password_hash, real_name, user_no, dept_id, class_id, valid_until)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [username, hash, realName, userNo, deptId, classId, validUntil],
      );
      const codes = Array.isArray(r.roles) && r.roles.length ? r.roles.map(String) : ['student'];
      const roleRows = await query(`SELECT id FROM sys_role WHERE code IN (${codes.map(() => '?').join(',')})`, codes);
      for (const rr of roleRows) {
        await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [ins.insertId, rr.id]);
      }
      created.push(username);
    }
  });

  await opLog(
    actor.userId,
    batch ? 'user.batchCreate' : 'user.create',
    'batch',
    auditDetail(actor, `created=${created.length} skipped=${skipped.length}`),
    actor.ip,
  );
  return {
    data: { created, skipped, defaultPassword: !batch && created.length ? DEFAULT_PWD : undefined },
    message: `成功创建 ${created.length} 个账号${skipped.length ? `，跳过 ${skipped.length} 个` : ''}`,
  };
}

/** 批量删除账号（admin 独占；管理员账号受保护，不可删） */
export async function batchDeleteUsers(actor, userIds) {
  if (!isAdmin(actor)) throw new HttpError(40301, '仅超级管理员可创建/删除账号', 403);
  const ids = Array.isArray(userIds) ? [...new Set(userIds.map(Number).filter(Boolean))] : [];
  if (ids.length === 0) throw new HttpError(41001, '缺少 userIds');
  if (ids.length > BATCH_MAX) throw new HttpError(41001, `单次最多删除 ${BATCH_MAX} 个`);
  if (ids.includes(actor.userId)) throw new HttpError(41005, '不能删除自己的账号');

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
  await opLog(
    actor.userId,
    'user.batchDelete',
    'batch',
    auditDetail(actor, `deleted=${deleted} protected=${protectedCount}`),
    actor.ip,
  );
  return {
    data: { deleted, protected: protectedCount },
    message: `已删除 ${deleted} 个账号${protectedCount ? `，跳过管理员/保护账号 ${protectedCount} 个` : ''}`,
  };
}

/** 启用 / 禁用账号（防自锁：不能改自己的状态） */
export async function setUserStatus(actor, targetId, status) {
  const target = await loadTarget(actor, Number(targetId));
  const next = Number(status) === 1 ? 1 : 0;
  if (target.id === actor.userId) throw new HttpError(41005, '不能修改自己的账号状态');
  await query('UPDATE sys_user SET status = ? WHERE id = ?', [next, target.id]);
  await opLog(actor.userId, 'user.setStatus', `user:${target.id}`, auditDetail(actor, String(next)), actor.ip);
  return { data: { userId: target.id, status: next }, message: next === 1 ? '账号已启用' : '账号已禁用' };
}

/** 改归属信息（学号/班级；院系只有超管能改 —— 否则辅导员可把用户 dept_id 置空逃出数据范围） */
export async function setUserProfile(actor, targetId, value = {}) {
  const target = await loadTarget(actor, Number(targetId));
  const userNo = String(value.userNo ?? '').trim().slice(0, 32);
  let deptId = target.dept_id;
  if (isAdmin(actor)) deptId = value.deptId ? Number(value.deptId) : null;
  const classId = value.classId ? Number(value.classId) : null;
  if (classId) {
    const cls = await query('SELECT id, dept_id FROM sys_class WHERE id = ?', [classId]);
    if (cls.length === 0) throw new HttpError(41001, '班级不存在');
    if (deptId && cls[0].dept_id !== deptId) throw new HttpError(41001, '班级不属于所选院系');
  }
  await query('UPDATE sys_user SET user_no = ?, dept_id = ?, class_id = ? WHERE id = ?', [userNo, deptId, classId, target.id]);
  await opLog(
    actor.userId,
    'user.setProfile',
    `user:${target.id}`,
    auditDetail(actor, JSON.stringify({ userNo, deptId, classId })),
    actor.ip,
  );
  return { data: { userId: target.id }, message: '归属信息已更新' };
}

/** 设置账号有效期（admin 独占） */
export async function setUserValidUntil(actor, targetId, validUntil) {
  const target = await loadTarget(actor, Number(targetId));
  if (!isAdmin(actor)) throw new HttpError(40301, '仅超级管理员可设置账号有效期', 403);
  const vu = parseValidUntil(validUntil);
  await query('UPDATE sys_user SET valid_until = ? WHERE id = ?', [vu, target.id]);
  await opLog(
    actor.userId,
    'user.setValidUntil',
    `user:${target.id}`,
    auditDetail(actor, vu ? String(vu).slice(0, 10) : 'long-term'),
    actor.ip,
  );
  return { data: { userId: target.id, validUntil: vu }, message: vu ? '有效期已更新' : '已设为长期有效' };
}

/** 重置登录密码（admin 独占；不能重置其他 admin 主账号） */
export async function resetUserPassword(actor, targetId, password) {
  const target = await loadTarget(actor, Number(targetId));
  if (!isAdmin(actor)) throw new HttpError(40301, '仅超级管理员可重置登录密码', 403);
  if (target.username === 'admin' && target.id !== actor.userId) {
    throw new HttpError(41009, '不能重置其他管理员的主账号密码');
  }
  let pwd = String(password || '').trim();
  if (!pwd) pwd = `Zh${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 90 + 10)}`;
  if (pwd.length < 8) throw new HttpError(41008, '密码至少 8 位');
  const hash = await bcrypt.hash(pwd, 10);
  await query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [hash, target.id]);
  await query('DELETE FROM sys_refresh_token WHERE user_id = ?', [target.id]);
  await opLog(actor.userId, 'user.resetPassword', `user:${target.id}`, auditDetail(actor, target.username), actor.ip);
  return { data: { userId: target.id, password: pwd }, message: `密码已重置：${pwd}（请立即告知用户）` };
}

/** 删除单个账号（admin 独占；admin 角色账号受保护；不能删自己） */
export async function deleteUser(actor, targetId) {
  const target = await loadTarget(actor, Number(targetId));
  if (!isAdmin(actor)) throw new HttpError(40301, '仅超级管理员可删除账号', 403);
  if (target.id === actor.userId) throw new HttpError(41005, '不能删除自己的账号');
  const isAdminTarget = await query(
    `SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.code = 'admin'`,
    [target.id],
  );
  if (isAdminTarget.length > 0) throw new HttpError(41007, '不能删除管理员账号，请先移除其管理员角色');
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [target.id]);
    await conn.query('DELETE FROM sys_refresh_token WHERE user_id = ?', [target.id]);
    await conn.query('DELETE FROM sys_user WHERE id = ?', [target.id]);
  });
  await opLog(actor.userId, 'user.delete', `user:${target.id}`, auditDetail(actor, target.username), actor.ip);
  return { data: { userId: target.id }, message: `已删除账号 ${target.username}` };
}

/** 分配角色（admin 独占；不能摘掉自己的 admin 角色） */
export async function setUserRoles(actor, targetId, value) {
  const target = await loadTarget(actor, Number(targetId));
  if (!isAdmin(actor)) throw new HttpError(40301, '仅超级管理员可分配角色', 403);
  const codes = Array.isArray(value) ? value.map((c) => String(c)).slice(0, 10) : [];
  if (codes.length === 0) throw new HttpError(41001, '至少保留一个角色');
  const roleRows = await query(`SELECT id, code FROM sys_role WHERE code IN (${codes.map(() => '?').join(',')})`, codes);
  if (roleRows.length !== codes.length) throw new HttpError(41001, '存在无效角色编码');
  if (target.id === actor.userId && !codes.includes('admin')) {
    throw new HttpError(41006, '不能移除自己的超级管理员角色');
  }
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [target.id]);
    for (const r of roleRows) {
      await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [target.id, r.id]);
    }
  });
  await opLog(actor.userId, 'user.setRoles', `user:${target.id}`, auditDetail(actor, codes.join(',')), actor.ip);
  return { data: { userId: target.id, roles: codes }, message: '角色已更新（重新登录后菜单生效）' };
}

/**
 * ★ 按账号名/姓名**精确批量**查用户（C5 目标解析专用）
 *
 * 为什么不能复用 findUsers 再在内存里筛：
 *   findUsers 是分页查询（默认按 id 排序、带 LIMIT），而本库有 500+ 账号 ——
 *   **新建的账号 id 最大、排在最后一页**，"禁用账号 xxx" 会查不到它，
 *   表现为"预览永远为空"。2026-10-09 线上验收就是踩到这个坑（临时账号刚好是最新的）。
 *   这里直接 SQL 精确匹配，既正确又便宜。
 *
 * 数据范围照旧生效（辅导员只能查到本院的人）。
 * @param {string[]} names 账号名或真实姓名
 */
export async function findUsersByNames(actor, names = []) {
  const list = [...new Set(names.map((s) => String(s).trim()).filter(Boolean))].slice(0, 100);
  if (!list.length) return [];
  const scope = dataScope(actor.roles, actor.deptId);
  const ph = list.map(() => '?').join(',');
  const where = [`(u.username IN (${ph}) OR u.real_name IN (${ph}))`];
  const params = [...list, ...list];
  if (scope.type === 'dept') {
    where.push('u.dept_id = ?');
    params.push(scope.deptId);
  } else if (scope.type !== 'all') {
    // ★★ 同 buildWhere 的兜底（2026-10-10 体检）：self 时不加条件 = 全校可见。
    //   本函数被 AI 的 C5 目标解析调用（角色受限），当前不可达，
    //   但同一文件里三处 scope 用法必须口径一致 —— 漏一处将来就会被复制出去。
    where.push('u.id = ?');
    params.push(actor.userId);
  }
  const rows = await query(
    `SELECT u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id,
            d.name AS dept_name,
            GROUP_CONCAT(r.code) AS role_codes
       FROM sys_user u
       LEFT JOIN sys_department d ON d.id = u.dept_id
       LEFT JOIN sys_user_role ur ON ur.user_id = u.id
       LEFT JOIN sys_role r ON r.id = ur.role_id
      WHERE ${where.join(' AND ')}
      GROUP BY u.id, u.username, u.real_name, u.user_no, u.status, u.dept_id, d.name
      ORDER BY u.id ASC
      LIMIT 100`,
    params,
  );
  return rows.map((r) => ({ ...r, roles: r.role_codes ? String(r.role_codes).split(',') : [] }));
}

/** 动作分发（handler 薄壳用） */
export async function handleUserAction(actor, body = {}) {
  const action = String(body.action || '');
  const targetId = Number(body.userId);
  const value = body.value;

  // ---- 无 userId 的管理动作：创建类（admin 独占） ----
  if (!targetId) {
    if (action === 'create') return createUsers(actor, body, { batch: false });
    if (action === 'batchCreate') return createUsers(actor, body, { batch: true });
    if (action === 'batchDelete') return batchDeleteUsers(actor, body.userIds);
    throw new HttpError(41001, '缺少 userId');
  }

  if (action === 'setStatus') return setUserStatus(actor, targetId, value);
  if (action === 'setProfile') return setUserProfile(actor, targetId, value);
  if (action === 'setValidUntil') return setUserValidUntil(actor, targetId, value);
  if (action === 'resetPassword') return resetUserPassword(actor, targetId, body.password);
  if (action === 'delete') return deleteUser(actor, targetId);
  if (action === 'setRoles') return setUserRoles(actor, targetId, value);
  throw new HttpError(41001, '不支持的操作');
}

export { DEFAULT_PWD, USERNAME_RE };
