// POST /api/auth/register — 学生自助注册（默认 student 角色）
// 安全：用户名/密码格式校验、IP 频控、事务保证"建用户+授角色"原子性、唯一键冲突兜底
// 邮箱验证：必须先通过 /api/auth/register/send-code 获取验证码，验证通过才建号
// 校园邮箱：可选填写未被占用的前缀（前缀@keaidang.com），仅系统内记录
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../../lib/db.js';
import { ok, fail, jsonError, readBody, clientIp, preflight } from '../../lib/http.js';
import { registerAllowed, registerRecord } from '../../lib/auth.js';

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/; // 字母开头, 4~32 位
const PASSWORD_MIN = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PREFIX_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const CAMPUS_DOMAIN = '@keaidang.com';
// 保留用户名：防止仿冒管理/系统账号做钓鱼
const RESERVED_NAMES = ['admin', 'root', 'administrator', 'system', 'sysop', 'operator', 'support', 'master'];

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const realName = String(body.realName || '').trim().slice(0, 32);
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim();
    const prefix = String(body.prefix || '').trim().toLowerCase();
    const ip = clientIp(context.request);

    if (!USERNAME_RE.test(username)) {
      return fail(41001, '用户名须为字母开头、4~32 位字母数字下划线');
    }
    if (RESERVED_NAMES.includes(username.toLowerCase())) {
      return fail(41002, '该用户名为系统保留，请更换');
    }
    if (password.length < PASSWORD_MIN || password.length > 64) {
      return fail(41001, `密码长度须为 ${PASSWORD_MIN}~64 位`);
    }
    if (!realName) return fail(41001, '请填写姓名');
    if (!EMAIL_RE.test(email)) return fail(41003, '邮箱格式不正确');
    if (!/^\d{6}$/.test(code)) return fail(43111, '请输入 6 位邮箱验证码');
    if (prefix && !PREFIX_RE.test(prefix)) {
      return fail(43112, '校园邮箱前缀须为 3~30 位小写字母/数字/._-，且以字母或数字开头');
    }
    if (!registerAllowed(ip)) return fail(42900, '注册过于频繁，请稍后再试', 429);

    const exists = await query('SELECT id FROM sys_user WHERE username = ?', [username]);
    if (exists.length > 0) return fail(41002, '用户名已被注册');

    // 外部邮箱未被其他账号绑定
    const dupEmail = await query('SELECT id FROM sys_user WHERE email = ? AND email != ""', [email]);
    if (dupEmail.length > 0) return fail(43114, '该邮箱已被其他账号绑定');

    // 校验验证码：取该邮箱最新一条未使用记录
    const codeRows = await query(
      `SELECT id, code, attempts, expires_at FROM sys_email_code
        WHERE email = ? AND purpose = 'register' AND used = 0
        ORDER BY id DESC LIMIT 1`,
      [email],
    );
    if (codeRows.length === 0) return fail(43111, '请先获取邮箱验证码');
    const rec = codeRows[0];
    if (Number(rec.attempts) >= 5) return fail(43111, '验证码错误次数过多，请重新获取');
    if (new Date(rec.expires_at).getTime() < Date.now()) return fail(43111, '验证码已过期，请重新获取');
    if (String(rec.code) !== code) {
      await query('UPDATE sys_email_code SET attempts = attempts + 1 WHERE id = ?', [rec.id]);
      const left = 5 - Number(rec.attempts) - 1;
      return fail(43111, `验证码不正确（剩余 ${Math.max(0, left)} 次机会）`);
    }

    // 校园邮箱前缀占用（系统内）
    const campusEmail = prefix ? `${prefix}${CAMPUS_DOMAIN}` : null;
    if (prefix) {
      const dupCampus = await query('SELECT id FROM sys_user WHERE campus_email = ?', [campusEmail]);
      if (dupCampus.length > 0) return fail(43112, '校园邮箱前缀已被占用，请换一个');
    }

    registerRecord(ip);
    const hash = await bcrypt.hash(password, 10);

    let userId;
    try {
      userId = await withTransaction(async (conn) => {
        const [ins] = await conn.query(
          `INSERT INTO sys_user (username, password_hash, real_name, email, email_verified, campus_email)
           VALUES (?, ?, ?, ?, 1, ?)`,
          [username, hash, realName, email, campusEmail],
        );
        const [roles] = await conn.query("SELECT id FROM sys_role WHERE code = 'student'");
        if (roles[0]) {
          await conn.query(
            'INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)',
            [ins.insertId, roles[0].id],
          );
        }
        // 验证码标记已使用
        await conn.query('UPDATE sys_email_code SET used = 1 WHERE id = ?', [rec.id]);
        return ins.insertId;
      });
    } catch (e) {
      // 并发注册同名时撞唯一键，回滚后友好提示
      if (e && e.code === 'ER_DUP_ENTRY') return fail(41002, '用户名已被注册');
      throw e;
    }

    return ok(
      { id: userId, username, realName, campusEmail },
      campusEmail ? `注册成功！你的校园邮箱：${campusEmail}` : '注册成功',
    );
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestGet() {
  return fail(40400, '方法不允许', 405);
}

export { preflight as onRequestOptions };
