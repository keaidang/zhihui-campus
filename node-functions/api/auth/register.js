// POST /api/auth/register — 学生自助注册（默认 student 角色）
import bcrypt from 'bcryptjs';
import { query } from '../../lib/db.js';
import { ok, fail, jsonError, readBody, clientIp } from '../../lib/http.js';

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/; // 字母开头, 4~32 位
const PASSWORD_MIN = 8;

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const realName = String(body.realName || '').trim().slice(0, 32);

    if (!USERNAME_RE.test(username)) {
      return fail(41001, '用户名须为字母开头、4~32 位字母数字下划线');
    }
    if (password.length < PASSWORD_MIN || password.length > 64) {
      return fail(41001, `密码长度须为 ${PASSWORD_MIN}~64 位`);
    }
    if (!realName) return fail(41001, '请填写姓名');

    const exists = await query('SELECT id FROM sys_user WHERE username = ?', [username]);
    if (exists.length > 0) return fail(41002, '用户名已被注册');

    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO sys_user (username, password_hash, real_name) VALUES (?, ?, ?)',
      [username, hash, realName],
    );
    const userId = result.insertId;

    // 默认授予学生角色
    const roleRows = await query("SELECT id FROM sys_role WHERE code = 'student'");
    if (roleRows[0]) {
      await query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [userId, roleRows[0].id]);
    }

    return ok({ id: userId, username, realName }, '注册成功');
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestGet() {
  return fail(40400, '方法不允许', 405);
}
