// POST /api/auth/register — 学生自助注册（默认 student 角色）
// 安全：用户名/密码格式校验、IP 频控、事务保证"建用户+授角色"原子性、唯一键冲突兜底
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../../lib/db.js';
import { ok, fail, jsonError, readBody, clientIp, preflight } from '../../lib/http.js';
import { registerAllowed, registerRecord } from '../../lib/auth.js';

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/; // 字母开头, 4~32 位
const PASSWORD_MIN = 8;

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const realName = String(body.realName || '').trim().slice(0, 32);
    const ip = clientIp(context.request);

    if (!USERNAME_RE.test(username)) {
      return fail(41001, '用户名须为字母开头、4~32 位字母数字下划线');
    }
    if (password.length < PASSWORD_MIN || password.length > 64) {
      return fail(41001, `密码长度须为 ${PASSWORD_MIN}~64 位`);
    }
    if (!realName) return fail(41001, '请填写姓名');
    if (!registerAllowed(ip)) return fail(42900, '注册过于频繁，请稍后再试', 429);

    const exists = await query('SELECT id FROM sys_user WHERE username = ?', [username]);
    if (exists.length > 0) return fail(41002, '用户名已被注册');

    registerRecord(ip);
    const hash = await bcrypt.hash(password, 10);

    let userId;
    try {
      userId = await withTransaction(async (conn) => {
        const [ins] = await conn.query(
          'INSERT INTO sys_user (username, password_hash, real_name) VALUES (?, ?, ?)',
          [username, hash, realName],
        );
        const [roles] = await conn.query("SELECT id FROM sys_role WHERE code = 'student'");
        if (roles[0]) {
          await conn.query(
            'INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)',
            [ins.insertId, roles[0].id],
          );
        }
        return ins.insertId;
      });
    } catch (e) {
      // 并发注册同名时撞唯一键，回滚后友好提示
      if (e && e.code === 'ER_DUP_ENTRY') return fail(41002, '用户名已被注册');
      throw e;
    }

    return ok({ id: userId, username, realName }, '注册成功');
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestGet() {
  return fail(40400, '方法不允许', 405);
}

export { preflight as onRequestOptions };
