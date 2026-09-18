// 数据库迁移执行器：node scripts/migrate.mjs database/schema-002-base.sql
// 一次性把所有语句（含 ALTER/INSERT）执行到 TiDB；已存在错误自动跳过
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const root = path.resolve(import.meta.dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const file = process.argv[2];
if (!file) {
  console.error('用法: node scripts/migrate.mjs <sql文件>');
  process.exit(1);
}

const sqlText = fs.readFileSync(path.join(root, file), 'utf8');
const statements = sqlText
  .split(/;\s*\n/)
  .map((s) => s.replace(/^\s*(--[^\n]*\n)+/g, '').trim())
  .filter((s) => s.length > 0);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 4000),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'zhihui_campus',
  timezone: '+08:00',
  ssl: { rejectUnauthorized: true },
  multipleStatements: false,
});

const log = [];
let ok = 0;
let skipped = 0;
for (const stmt of statements) {
  const head = stmt.split('\n')[0].slice(0, 70);
  try {
    await conn.query(stmt);
    ok += 1;
    log.push(`  OK   ${head}`);
  } catch (e) {
    // 1060 列已存在 / 1061 索引已存在 / 1050 表已存在 → 幂等跳过
    if ([1060, 1061, 1050].includes(e.errno)) {
      skipped += 1;
      log.push(`  SKIP ${head} (${e.errno} ${e.sqlMessage})`);
    } else {
      log.push(`  FAIL ${head} :: ${e.errno} ${e.sqlMessage}`);
    }
  }
}

const rows = await conn.query('SELECT code, name FROM sys_role ORDER BY id');
log.push('');
log.push('  角色表现状: ' + rows[0].map((r) => `${r.code}/${r.name}`).join(', '));
const depts = await conn.query('SELECT COUNT(*) AS c FROM sys_department');
log.push('  院系数量: ' + depts[0][0].c);
const classes = await conn.query('SELECT COUNT(*) AS c FROM sys_class');
log.push('  班级数量: ' + classes[0][0].c);
const cols = await conn.query("SHOW COLUMNS FROM sys_user LIKE 'dept_id'");
log.push('  sys_user.dept_id 存在: ' + (cols[0].length > 0));

fs.writeFileSync(path.join(root, 'migrate-report.txt'), `执行 ${file}\n成功 ${ok} 条, 跳过 ${skipped} 条\n` + log.join('\n'));
await conn.end();
