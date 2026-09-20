// scripts/gap-check.mjs — 项目剩余项盘点（只读，不改任何数据）
// 用途：新会话开工前 / 交付前快速确认「计划已完成 vs 尚未做到」，输出实测数据供对照 docs/PROGRESS.md 阶段 5。
// 运行：node scripts/gap-check.mjs
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

const q = async (sql) => { const [r] = await conn.query(sql); return r; };
const one = async (sql) => (await q(sql))[0] || {};
const line = (label, val) => console.log(`  ${label.padEnd(30)} ${val}`);

console.log('\n=== 规模 ===');
const t = ['sys_user', 'sys_class', 'sys_department', 'edu_course', 'lib_book', 'lib_loan',
  'lf_item', 'club_application', 'forum_thread', 'forum_reply', 'dorm_assignment',
  'sys_message', 'sys_mail_sent', 'sys_blob', 'sys_op_log'];
for (const tb of t) {
  const { n } = await one(`SELECT COUNT(*) n FROM ${tb}`);
  line(tb, n);
}

console.log('\n=== 角色分布 ===');
for (const r of await q(`SELECT ro.code, COUNT(*) n FROM sys_user_role ur JOIN sys_role ro ON ro.id = ur.role_id GROUP BY ro.code ORDER BY n DESC`)) {
  line(r.code, r.n);
}

console.log('\n=== 剩余项实测 ===');
const bc = await one("SELECT COUNT(*) total, SUM(cover_url IS NULL OR cover_url='') no_cover FROM lib_book");
line('图书封面覆盖', `${bc.total - bc.no_cover}/${bc.total}（缺 ${bc.no_cover}）`);
const bl = await one('SELECT COUNT(*) n, ROUND(SUM(LENGTH(data))/1024/1024, 2) mb FROM sys_blob');
line('sys_blob（待接图床）', `${bl.n} 条 / ${bl.mb} MB`);
const rt = await one('SELECT COUNT(*) total, SUM(expires_at < NOW() OR revoked = 1) dead FROM sys_refresh_token');
line('刷新令牌（可清理）', `${rt.total} 条，其中 ${rt.dead} 条过期/已吊销`);
const lf = await one('SELECT COUNT(*) n FROM sys_login_log');
line('登录日志（可清理）', `${lf.n} 条`);
const ms = await one('SELECT COUNT(*) total, SUM(read_at IS NULL) unread FROM sys_message');
line('站内信', `${ms.total} 条，未读 ${ms.unread}`);

console.log('\n=== 演示账号残留排查 ===');
const junk = await q("SELECT id, username, created_at FROM sys_user WHERE username LIKE 'zhreg%' OR username LIKE 'tmp%' OR username LIKE 'test%'");
if (!junk.length) console.log('  无');
for (const u of junk) line(u.username, `id=${u.id} 注册于 ${u.created_at.toISOString().slice(0, 16)}Z`);

console.log('\n=== 线上错误（sys_op_log） ===');
const err = await q("SELECT action, detail, COUNT(*) n, MAX(created_at) last FROM sys_op_log WHERE action LIKE 'error%' GROUP BY action, detail ORDER BY last DESC LIMIT 8");
if (!err.length) console.log('  无');
for (const e of err) {
  const ageMin = Math.round((Date.now() - new Date(e.last).getTime()) / 60000);
  line(`[${ageMin} 分钟前] ${e.action}`, `${e.n} 次 · ${String(e.detail).slice(0, 60)}`);
}
console.log('  （仅看 MAX(created_at) 距今多久判断是否仍在发生；历史已修复 bug 的 500 会永久留痕，属正常）\n');

await conn.end();
