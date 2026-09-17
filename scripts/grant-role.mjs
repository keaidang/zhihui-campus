// 角色授予脚本（本地引导用，不进函数运行时）
// 用法:
//   node scripts/grant-role.mjs <username> <roleCode> [--create] [--dept=CS]
// 例: node scripts/grant-role.mjs admin admin --create --dept=CS
//     → 创建/更新用户 admin（默认密码 Zhihui@2026，首次登录务必改密）并授予管理员角色
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const root = path.resolve(import.meta.dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const [username, roleCode] = process.argv.slice(2);
const create = process.argv.includes('--create');
const deptCode = (process.argv.find((a) => a.startsWith('--dept=')) || '').split('=')[1] || '';
const DEFAULT_PWD = 'Zhihui@2026';

const log = [];
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 4000),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'zhihui_campus',
  timezone: '+08:00',
  ssl: { rejectUnauthorized: true },
});

if (!username || !roleCode) {
  log.push('用法: node scripts/grant-role.mjs <username> <roleCode> [--create] [--dept=CS]');
} else {
  const [roles] = await conn.query('SELECT id FROM sys_role WHERE code = ?', [roleCode]);
  if (roles.length === 0) {
    log.push(`角色 ${roleCode} 不存在（先跑 schema-002-base.sql）`);
  } else {
    let [users] = await conn.query('SELECT id, username FROM sys_user WHERE username = ?', [username]);
    if (users.length === 0 && create) {
      let deptId = null;
      if (deptCode) {
        const [d] = await conn.query('SELECT id FROM sys_department WHERE code = ?', [deptCode]);
        deptId = d[0]?.id ?? null;
      }
      const hash = bcrypt.hashSync(DEFAULT_PWD, 10);
      const [ins] = await conn.query(
        'INSERT INTO sys_user (username, password_hash, real_name, dept_id, user_no) VALUES (?, ?, ?, ?, ?)',
        [username, hash, '系统管理员', deptId, 'ADMIN001'],
      );
      users = [{ id: ins.insertId, username }];
      log.push(`已创建用户 ${username}，初始密码 ${DEFAULT_PWD}（请立即修改）`);
    }
    if (users.length === 0) {
      log.push(`用户 ${username} 不存在（加 --create 可自动创建）`);
    } else {
      // --reset：把密码重置为默认值（忘记密码时用；线上务必登录后立即改密）
      if (process.argv.includes('--reset')) {
        await conn.query('UPDATE sys_user SET password_hash = ?, status = 1 WHERE id = ?', [
          bcrypt.hashSync(DEFAULT_PWD, 10),
          users[0].id,
        ]);
        log.push(`已将 ${username} 的密码重置为 ${DEFAULT_PWD} 并启用账号（请立即修改）`);
      }
      await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [
        users[0].id,
        roles[0].id,
      ]);
      const [now] = await conn.query(
        `SELECT r.code FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id WHERE ur.user_id = ?`,
        [users[0].id],
      );
      log.push(`用户 ${username}(id=${users[0].id}) 现有角色: ${now.map((r) => r.code).join(', ')}`);
    }
  }
}

fs.writeFileSync(path.join(root, 'grant-report.txt'), log.join('\n'));
await conn.end();
