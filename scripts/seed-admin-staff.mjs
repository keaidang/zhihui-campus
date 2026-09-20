// scripts/seed-admin-staff.mjs — 行政部门人员数据生成（幂等）
// 前置：先执行 database/schema-006-admin-depts.sql（本脚本也会尝试自动执行）
// 生成：10 个行政部门 + 约 30 名行政人员（leader 角色，按部门归属）
// 用法：node scripts/seed-admin-staff.mjs
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

let conn = null;
for (let i = 0; i < 8 && !conn; i++) {
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: +process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: true },
      connectTimeout: 20000,
      multipleStatements: true,
    });
  } catch (e) {
    console.log(`连接失败（第 ${i + 1} 次）：${e.code || e.message}，8s 后重试…`);
    await new Promise((s) => setTimeout(s, 8000));
  }
}
if (!conn) { console.error('多次重试后仍无法连接数据库'); process.exit(1); }

// 1. 执行 schema-006（幂等）：先剥离注释行，再按分号分段
const sql = fs.readFileSync('database/schema-006-admin-depts.sql', 'utf8');
const stmts = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
for (const stmt of stmts) {
  await conn.query(stmt);
}
console.log('schema-006 已执行（dept_type 字段 + 行政部门），共', stmts.length, '条语句');

// 2. 行政人员名单（姓名/部门编码/职务序号），真实感中文姓名
const PLAN = [
  ['XZS', ['陈国华', '周建明', '吴淑芬']],      // 校长室
  ['DW',  ['刘正德', '孙雅琴']],               // 党委办公室
  ['JWC', ['张伟明', '李慧珍', '王立群', '赵鹏飞']], // 教务处
  ['XGC', ['黄志强', '徐丽华', '马晓东', '朱海燕']], // 学生工作处
  ['TW',  ['胡文斌', '林婷婷', '郑凯文']],     // 校团委
  ['RSC', ['杨建华', '何雪梅']],               // 人事处
  ['CWC', ['高秀兰', '罗天宇']],               // 财务处
  ['ZJC', ['梁国栋', '谢春花', '韩志远']],     // 招生就业处
  ['HQC', ['冯长顺', '曹丽娟', '邓小刚']],     // 后勤保障处
  ['TSG', ['曾书华', '肖梦秋', '田文博']],     // 图书馆
];
const TITLE = ['处长', '副处长', '科长', '主任', '馆员', '干事'];

const [roles] = await conn.query("SELECT id FROM sys_role WHERE code = 'leader'");
const leaderRoleId = roles[0].id;
const PASSWORD_HASH = bcrypt.hashSync('Zhihui@2026', 10);

const [depts] = await conn.query("SELECT id, code, name FROM sys_department WHERE dept_type = 'admin'");
const deptByCode = Object.fromEntries(depts.map((d) => [d.code, d]));

let created = 0;
let seq = 1;
for (const [code, names] of PLAN) {
  const dept = deptByCode[code];
  if (!dept) { console.log('缺少部门', code); continue; }
  for (let i = 0; i < names.length; i++) {
    const username = `${code.toLowerCase()}${String(i + 1).padStart(2, '0')}`;
    const userNo = `A2026${String(seq++).padStart(3, '0')}`;
    const [exist] = await conn.query('SELECT id FROM sys_user WHERE username = ?', [username]);
    if (exist.length) continue;
    const [r] = await conn.query(
      'INSERT INTO sys_user (username, password_hash, real_name, user_no, dept_id, status) VALUES (?, ?, ?, ?, ?, 1)',
      [username, PASSWORD_HASH, names[i], userNo, dept.id],
    );
    await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?, ?)', [r.insertId, leaderRoleId]);
    created++;
  }
}

// 3. 汇总
const [sum] = await conn.query(
  `SELECT d.code, d.name, COUNT(u.id) staff
     FROM sys_department d
     LEFT JOIN sys_user u ON u.dept_id = d.id AND u.status = 1
    WHERE d.dept_type = 'admin'
    GROUP BY d.id, d.code, d.name ORDER BY d.sort`,
);
console.log('--- 行政部门人员分布 ---');
console.log(sum.map((r) => `${r.name}(${r.code}):${r.staff}人`).join(' | '));
const [st] = await conn.query(
  `SELECT COUNT(*) n FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id
    WHERE r.code='leader' AND u.username NOT LIKE 'leader%'`,
);
console.log(`本次新增行政人员: ${created} 名（行政序列 leader 角色共 ${st[0].n} 名）`);
console.log('✅ 行政部门数据完成。默认密码均为 Zhihui@2026');
await conn.end();
