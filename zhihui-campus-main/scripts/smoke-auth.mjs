// 冒烟测试：用生产驱动 (mysql2 + bcryptjs + jsonwebtoken) 真实走一遍认证核心链路
// 运行: node --env-file=.env scripts/smoke-auth.mjs  (输出到 scripts/smoke-result.txt)
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'node:url';

import { getPool, query } from '../node-functions/lib/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'scripts', 'smoke-result.txt');
const lines = [];
const log = (s) => lines.push(String(s));

try {
  const t0 = Date.now();
  const pool = getPool();
  const [r] = await pool.query('SELECT 1 AS ping');
  log(`[OK] mysql2 + TLS 连接成功 (${Date.now() - t0}ms), ping=${r[0].ping}`);

  // 1) 模拟注册：bcrypt 哈希入库
  const username = '_smoke_' + Date.now().toString(36);
  const hash = await bcrypt.hash('TestPass123', 10);
  const ins = await query(
    'INSERT INTO sys_user (username, password_hash, real_name) VALUES (?, ?, ?)',
    [username, hash, '冒烟测试'],
  );
  log(`[OK] 注册写入: id=${ins.insertId}`);

  // 2) 模拟登录：取出哈希并比对
  const users = await query('SELECT id, password_hash FROM sys_user WHERE username = ?', [username]);
  const match = await bcrypt.compare('TestPass123', users[0].password_hash);
  const bad = await bcrypt.compare('WrongPass', users[0].password_hash);
  log(`[OK] bcrypt 校验: 正确密码=${match}, 错误密码=${bad}`);
  if (!match || bad) throw new Error('bcrypt 校验不符合预期');

  // 3) 模拟签发/校验 JWT
  const token = jwt.sign({ sub: String(users[0].id), roles: ['student'] }, process.env.JWT_SECRET, { expiresIn: '2h' });
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  log(`[OK] JWT 签发/校验: sub=${payload.sub}, roles=${payload.roles.join(',')}`);

  // 4) 角色关联查询（与 login.js 同 SQL）
  const roles = await query(
    `SELECT r.code FROM sys_role r JOIN sys_user_role ur ON ur.role_id = r.id
      JOIN sys_user u ON u.id = ur.user_id WHERE u.username = ?`, [username]);
  log(`[OK] 角色查询: ${roles.map((x) => x.code).join(',') || '(注册默认 student 未挂接, 属冒烟脚本直接插表所致)'}`);

  // 5) 清理测试数据
  await query('DELETE FROM sys_user_role WHERE user_id = ?', [users[0].id]);
  await query('DELETE FROM sys_user WHERE id = ?', [users[0].id]);
  log('[OK] 测试数据已清理');
  await pool.end();
  log('[DONE] 冒烟测试全部通过');
} catch (e) {
  log(`[FAIL] ${e.message}\n${e.stack}`);
  fs.writeFileSync(OUT, lines.join('\n'), 'utf-8');
  process.exit(1);
}
fs.writeFileSync(OUT, lines.join('\n'), 'utf-8');
