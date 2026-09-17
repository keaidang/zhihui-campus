// 本地复现登录成功路径：逐条执行与 login.js 相同的 SQL（用完即删）
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { query, getPool, withTransaction } from './lib/db.js';

// 手动加载 ../.env（项目未装 dotenv）
for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const lines = [];
const log = (...a) => { const s = a.join(' '); lines.push(s); fs.writeFileSync(new URL('./probe-report.txt', import.meta.url), lines.join('\n')); };
process.on('unhandledRejection', (e) => log('UNHANDLED:', e && e.message));
process.on('uncaughtException', (e) => log('UNCAUGHT:', e && e.message));

const hash = bcrypt.hashSync('TestPass1234', 10);
const uname = 'probe_' + crypto.randomBytes(3).toString('hex');

try {
  // 1) 注册等价操作
  await withTransaction(async (conn) => {
    const [r] = await conn.execute(
      'INSERT INTO sys_user (username, password_hash, real_name) VALUES (?, ?, ?)',
      [uname, hash, '探针用户'],
    );
    await conn.execute('INSERT INTO sys_user_role (user_id, role_id) VALUES (?, (SELECT id FROM sys_role WHERE code = ?))', [r.insertId, 'student']);
  });
  log('[1] 注册等价 OK:', uname);

  // 2) 登录查询
  const users = await query('SELECT id, username, password_hash, real_name, status FROM sys_user WHERE username = ?', [uname]);
  log('[2] 用户查询 OK, valid =', await bcrypt.compare('TestPass1234', users[0].password_hash));

  // 3) 角色查询
  const roles = (await query('SELECT r.code FROM sys_role r JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ?', [users[0].id])).map((r) => r.code);
  log('[3] 角色查询 OK:', roles);

  // 4) saveRefreshToken —— Date 参数 INSERT（重点怀疑）
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  await query('INSERT INTO sys_refresh_token (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [users[0].id, crypto.createHash('sha256').update('probe').digest('hex'), expiresAt]);
  log('[4] 刷新令牌 INSERT(Date 参数) OK, expires_at =', expiresAt);

  // 5) last_login 更新 + 审计
  await query('UPDATE sys_user SET last_login_at = NOW() WHERE id = ?', [users[0].id]);
  await query('INSERT INTO sys_login_log (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, 1)', [users[0].id, uname, '127.0.0.1', 'probe', 1]);
  log('[5] last_login + 审计 OK');

  log('== 全部通过：成功路径 SQL 均无异常 ==');
} catch (e) {
  log('ERR','!! 复现到错误:', e.code, e.message, e.sql || '');
} finally {
  // 清理探针数据
  try {
    await withTransaction(async (conn) => {
      const [u] = await conn.execute('SELECT id FROM sys_user WHERE username = ?', [uname]);
      if (u[0]) {
        await conn.execute('DELETE FROM sys_user_role WHERE user_id = ?', [u[0].id]);
        await conn.execute('DELETE FROM sys_refresh_token WHERE user_id = ?', [u[0].id]);
        await conn.execute('DELETE FROM sys_login_log WHERE user_id = ?', [u[0].id]);
        await conn.execute('DELETE FROM sys_user WHERE id = ?', [u[0].id]);
      }
    });
    log('探针数据已清理');
  } catch (e2) { console.error('清理失败:', e2.message); }
  await getPool().end();
}
