// scripts/integrity-check.mjs — 数据一致性体检（只读，不改任何数据）
// 用法：node scripts/integrity-check.mjs   输出各类"不一致项"计数与明细
// 注意：本脚本里的字段名必须对照真实 DDL（曾因写成 total/available、student_id 而误报）
// 数据一致性体检（修正版：按真实 DDL 取字段名与类型）
import fs from 'node:fs';
import mysql from 'mysql2/promise';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: true }, connectTimeout: 20000, timezone: 'Z',
});
const q = async (sql) => (await conn.query(sql))[0];

console.log('=== 复核上一轮报出的 4 项 ===');
const again = [
  ['无角色用户（登录后无任何权限）', "SELECT COUNT(*) n FROM sys_user u WHERE NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id=u.id)"],
  ['图书 available_copies ≠ 总数-在借', `SELECT COUNT(*) n FROM lib_book b
      WHERE b.available_copies <> b.total_copies - (SELECT COUNT(*) FROM lib_loan l WHERE l.book_id=b.id AND l.returned_at IS NULL)`],
  ['住宿性别与楼栋不匹配（正确类型比较）', `SELECT COUNT(*) n FROM dorm_assignment a
      JOIN dorm_room rm ON rm.id=a.room_id JOIN dorm_building b ON b.id=rm.building_id JOIN sys_user u ON u.id=a.user_id
      WHERE a.check_out_at IS NULL AND ((b.gender='male' AND u.gender<>1) OR (b.gender='female' AND u.gender<>2))`],
  ['报修单缺审批流实例', "SELECT COUNT(*) n FROM af_repair r WHERE NOT EXISTS (SELECT 1 FROM flow_instance f WHERE f.biz_id=r.id AND f.biz_type='repair')"],
  ['学生缺班级归属', "SELECT COUNT(*) n FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id WHERE r.code='student' AND u.class_id IS NULL"],
  ['学生未分配宿舍', `SELECT COUNT(*) n FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id
      WHERE r.code='student' AND NOT EXISTS (SELECT 1 FROM dorm_assignment a WHERE a.user_id=u.id AND a.check_out_at IS NULL)`],
];
for (const [label, sql] of again) {
  const [row] = await q(sql);
  const n = Number(row.n);
  console.log(`${n > 0 ? '⚠ ' : '  '}${label.padEnd(38)}${n}`);
}

console.log('\n=== 明细追查 ===');
console.log('· 无角色用户：');
for (const u of await q("SELECT u.id,u.username,u.real_name,u.created_at FROM sys_user u WHERE NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id=u.id)")) {
  console.log(`    id=${u.id} ${u.username} ${u.real_name} 注册于 ${u.created_at.toISOString().slice(0, 16)}Z`);
}
console.log('· 缺审批流的报修单：');
for (const r of await q(`SELECT r.id,r.status,r.created_at,u.username FROM af_repair r LEFT JOIN sys_user u ON u.id=r.user_id
    WHERE NOT EXISTS (SELECT 1 FROM flow_instance f WHERE f.biz_id=r.id AND f.biz_type='repair')`)) {
  console.log(`    #${r.id} status=${r.status} 提交人=${r.username} 时间=${r.created_at.toISOString().slice(0, 16)}Z`);
}
console.log('· 缺班级的学生：');
for (const u of await q("SELECT u.id,u.username,u.real_name,u.dept_id,u.created_at FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id WHERE r.code='student' AND u.class_id IS NULL")) {
  console.log(`    id=${u.id} ${u.username} ${u.real_name} dept=${u.dept_id} 注册于 ${u.created_at.toISOString().slice(0, 16)}Z`);
}
console.log('· 未分配宿舍的学生：');
for (const u of await q(`SELECT u.id,u.username,u.real_name,u.created_at FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id
    WHERE r.code='student' AND NOT EXISTS (SELECT 1 FROM dorm_assignment a WHERE a.user_id=u.id AND a.check_out_at IS NULL)`)) {
  console.log(`    id=${u.id} ${u.username} ${u.real_name} 注册于 ${u.created_at.toISOString().slice(0, 16)}Z`);
}
console.log('· 有退宿历史的（正常，留痕）：', (await q("SELECT COUNT(*) n FROM dorm_assignment WHERE check_out_at IS NOT NULL"))[0].n);

await conn.end();
