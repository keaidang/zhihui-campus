// 本地稳定性探针：新文本协议 db.js 连跑 5 轮登录成功路径（用完即删）
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { query, getPool, withTransaction } from './lib/db.js';

for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const lines = [];
const log = (...a) => { lines.push(a.join(' ')); fs.writeFileSync(new URL('./probe2-report.txt', import.meta.url), lines.join('\n')); };

let jwtErr = null;
try {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) throw new Error('JWT_SECRET 未配置或过弱');
  const jwt = await import('jsonwebtoken');
  const tok = jwt.default.sign({ sub: '1', username: 'x', roles: ['student'] }, secret, { expiresIn: 7200, algorithm: 'HS256' });
  jwt.default.verify(tok, secret, { algorithms: ['HS256'] });
  log('[0] JWT 签发/校验 OK');
} catch (e) { jwtErr = e; log('[0] JWT 失败:', e.message); }

for (let i = 1; i <= 5; i++) {
  const uname = 'stab_' + crypto.randomBytes(3).toString('hex');
  try {
    await withTransaction(async (conn) => {
      const [r] = await conn.query('INSERT INTO sys_user (username, password_hash, real_name) VALUES (?, ?, ?)', [uname, bcrypt.hashSync('Probe12345', 10), '稳定探针']);
      await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, (SELECT id FROM sys_role WHERE code = ?))', [r.insertId, 'student']);
    });
    const users = await query('SELECT id, username, password_hash, real_name, status FROM sys_user WHERE username = ?', [uname]);
    const valid = await bcrypt.compare('Probe12345', users[0].password_hash);
    const roles = (await query('SELECT r.code FROM sys_role r JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ?', [users[0].id])).map((r) => r.code);
    await query('INSERT INTO sys_refresh_token (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [users[0].id, crypto.createHash('sha256').update(crypto.randomBytes(16)).digest('hex'), new Date(Date.now() + 6048e5)]);
    await query('UPDATE sys_user SET last_login_at = NOW() WHERE id = ?', [users[0].id]);
    await query('INSERT INTO sys_login_log (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, 1)', [users[0].id, uname, '127.0.0.1', 'probe2', 1]);
    log(`[第${i}轮] OK valid=${valid} roles=${roles.join(',')}`);
    // 清理
    await withTransaction(async (conn) => {
      const [u] = await conn.query('SELECT id FROM sys_user WHERE username = ?', [uname]);
      await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [u[0].id]);
      await conn.query('DELETE FROM sys_refresh_token WHERE user_id = ?', [u[0].id]);
      await conn.query('DELETE FROM sys_login_log WHERE user_id = ?', [u[0].id]);
      await conn.query('DELETE FROM sys_user WHERE id = ?', [u[0].id]);
    });
  } catch (e) {
    log(`[第${i}轮] 失败: ${e.code || ''} ${e.message}`);
  }
}
log('== 稳定性测试结束 ==');
await getPool().end();
