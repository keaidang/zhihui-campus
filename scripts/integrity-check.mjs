// scripts/integrity-check.mjs — 数据一致性体检（只读，不改任何数据）
// 用法：node scripts/integrity-check.mjs   输出各类"不一致项"计数与明细
// 注意：本脚本里的字段名必须对照真实 DDL（曾因写成 total/available、student_id 而误报）
// 数据一致性体检（修正版：按真实 DDL 取字段名与类型）
import fs from 'node:fs';
import mysql from 'mysql2/promise';

for (const line of (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: true }, connectTimeout: 20000, timezone: 'Z',
});
const q = async (sql) => (await conn.query(sql))[0];

console.log('=== 数据一致性体检（6 项 → 5 项，2026-10-07：报修已改状态机不建 flow_instance，铁律 #34，原“报修单缺审批流实例”检查作废）===');
const again = [
  ['无角色用户（登录后无任何权限）', "SELECT COUNT(*) n FROM sys_user u WHERE u.status=1 AND NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id=u.id)"],
  ['图书 available_copies ≠ 总数-在借', `SELECT COUNT(*) n FROM lib_book b
      WHERE b.available_copies <> b.total_copies - (SELECT COUNT(*) FROM lib_loan l WHERE l.book_id=b.id AND l.returned_at IS NULL)`],
  ['住宿性别与楼栋不匹配（正确类型比较）', `SELECT COUNT(*) n FROM dorm_assignment a
      JOIN dorm_room rm ON rm.id=a.room_id JOIN dorm_building b ON b.id=rm.building_id JOIN sys_user u ON u.id=a.user_id
      WHERE a.check_out_at IS NULL AND ((b.gender='male' AND u.gender<>1) OR (b.gender='female' AND u.gender<>2))`],
  ['纯学生缺班级归属（排除管理号/停用号）', "SELECT COUNT(*) n FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id WHERE r.code='student' AND u.status = 1 AND u.class_id IS NULL AND NOT EXISTS (SELECT 1 FROM sys_user_role ur2 JOIN sys_role r2 ON r2.id = ur2.role_id WHERE ur2.user_id = u.id AND r2.code IN ('admin','teacher','counselor','leader'))"],
  ['纯学生未分配宿舍（排除管理号/停用号）', `SELECT COUNT(*) n FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code='student' AND u.status = 1 AND NOT EXISTS (SELECT 1 FROM dorm_assignment a WHERE a.user_id=u.id AND a.check_out_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM sys_user_role ur2 JOIN sys_role r2 ON r2.id = ur2.role_id WHERE ur2.user_id = u.id AND r2.code IN ('admin','teacher','counselor','leader'))`],
];
for (const [label, sql] of again) {
  const [row] = await q(sql);
  const n = Number(row.n);
  console.log(`${n > 0 ? '⚠ ' : '  '}${label.padEnd(38)}${n}`);
}

// ============================================================
// 选课 / 成绩的学期语义不变量（2026-10-10 新增）
// ------------------------------------------------------------
// 背景：scripts/seed-demo-data.mjs 曾给**当前学期**的选课记录直接写分数并把 status
// 改成 2（已出成绩），导致 2015 条"在选"记录全变成"已出成绩" ——
//   选课页判断"我是否选了这门课"用的是 status=1，于是所有课都显示"选课"，
//   学生看不到自己选了什么、也退不了课。
// 这类"语义反了"的破坏不会触发任何报错，只有数据体检能兜住，所以固化成两条硬断言。
// ============================================================
console.log('\n=== 选课/成绩一致性（学期语义不变量）===');
const [badTerm] = await q(
  "SELECT COUNT(*) n FROM edu_elect WHERE term = '2026-2027-1' AND status <> 1",
);
console.log(`${Number(badTerm.n) > 0 ? '⚠ ' : '  '}当前学期非「在选」的选课记录（应为 0）${Number(badTerm.n)}`);
const [badCap] = await q(
  `SELECT COUNT(*) n FROM edu_class c
    WHERE c.term = '2026-2027-1'
      AND c.enrolled <> (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status = 1)`,
);
console.log(`${Number(badCap.n) > 0 ? '⚠ ' : '  '}教学班 enrolled 与在选记录数不一致（应为 0）${Number(badCap.n)}`);
const [graded] = await q(
  "SELECT COUNT(DISTINCT term) n FROM edu_elect WHERE status = 2 AND score IS NOT NULL",
);
console.log(`  已出成绩的记录分布在 ${graded.n} 个学期（成绩必须挂历史学期，不能挂当前学期）`);
const electProblems = Number(badTerm.n) + Number(badCap.n);

console.log('\n=== 明细追查 ===');
console.log('· 无角色用户：');
for (const u of await q("SELECT u.id,u.username,u.real_name,u.created_at FROM sys_user u WHERE u.status=1 AND NOT EXISTS (SELECT 1 FROM sys_user_role ur WHERE ur.user_id=u.id)")) {
  console.log(`    id=${u.id} ${u.username} ${u.real_name} 注册于 ${u.created_at.toISOString().slice(0, 16)}Z`);
}
console.log('· 缺班级的纯学生：');
for (const u of await q("SELECT u.id,u.username,u.real_name,u.dept_id,u.created_at FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id WHERE r.code='student' AND u.status=1 AND u.class_id IS NULL AND NOT EXISTS (SELECT 1 FROM sys_user_role ur2 JOIN sys_role r2 ON r2.id=ur2.role_id WHERE ur2.user_id=u.id AND r2.code IN ('admin','teacher','counselor','leader'))")) {
  console.log(`    id=${u.id} ${u.username} ${u.real_name} dept=${u.dept_id} 注册于 ${u.created_at.toISOString().slice(0, 16)}Z`);
}
console.log('· 未分配宿舍的纯学生：');
for (const u of await q(`SELECT u.id,u.username,u.real_name,u.created_at FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id
    WHERE r.code='student' AND u.status=1 AND NOT EXISTS (SELECT 1 FROM dorm_assignment a WHERE a.user_id=u.id AND a.check_out_at IS NULL)
    AND NOT EXISTS (SELECT 1 FROM sys_user_role ur2 JOIN sys_role r2 ON r2.id=ur2.role_id WHERE ur2.user_id=u.id AND r2.code IN ('admin','teacher','counselor','leader'))`)) {
  console.log(`    id=${u.id} ${u.username} ${u.real_name} 注册于 ${u.created_at.toISOString().slice(0, 16)}Z`);
}
console.log('· 有退宿历史的（正常，留痕）：', (await q("SELECT COUNT(*) n FROM dorm_assignment WHERE check_out_at IS NOT NULL"))[0].n);

await conn.end();
// 学期语义是**硬不变量**：破坏它会让整个选课功能失灵（用户完全看不出自己选了什么），
// 所以这里**必须以非零退出码失败**，让 `npm run check` 拦得住 —— 其余检查保持"只报告"。
if (electProblems > 0) {
  console.error(`\n✗ 选课/成绩语义检查未通过（${electProblems} 项）—— 请跑 \`node scripts/seed-demo-data.mjs --fix-elect\``);
  process.exit(1);
}
console.log('\n✓ 选课/成绩语义检查通过');
process.exit(0);
