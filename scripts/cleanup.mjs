// 运维清理脚本：sys_refresh_token（过期/吊销）+ sys_blob（超期未引用）+ sys_login_log（超期审计）
// 用法：node scripts/cleanup.mjs [--blob-days=90] [--log-days=365] [--yes]
//   默认 dry-run 只打印将删除的行数；--yes 才真正执行
// 登录链路已内置 5% 概率顺带清理刷新令牌（login.js），本脚本用于 blob/日志与手动兜底。
import fs from 'node:fs';
import mysql from 'mysql2/promise';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) process.env[m[1]] = m[2];
}
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(name + '='));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const blobDays = arg('--blob-days', 90);
const logDays = arg('--log-days', 365);
const yes = process.argv.includes('--yes');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: +process.env.DB_PORT,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: true }, timezone: '+08:00',
  multipleStatements: false,
});

const jobs = [
  ['sys_refresh_token 过期>7天', `SELECT COUNT(*) n FROM sys_refresh_token WHERE expires_at < NOW() - INTERVAL 7 DAY`, `DELETE FROM sys_refresh_token WHERE expires_at < NOW() - INTERVAL 7 DAY`],
  ['sys_refresh_token 吊销>30天', `SELECT COUNT(*) n FROM sys_refresh_token WHERE revoked = 1 AND created_at < NOW() - INTERVAL 30 DAY`, `DELETE FROM sys_refresh_token WHERE revoked = 1 AND created_at < NOW() - INTERVAL 30 DAY`],
  [`sys_blob 超过${blobDays}天`, `SELECT COUNT(*) n, ROUND(SUM(size)/1048576,1) mb FROM sys_blob WHERE created_at < NOW() - INTERVAL ${blobDays} DAY`, `DELETE FROM sys_blob WHERE created_at < NOW() - INTERVAL ${blobDays} DAY`],
  [`sys_login_log 超过${logDays}天`, `SELECT COUNT(*) n FROM sys_login_log WHERE created_at < NOW() - INTERVAL ${logDays} DAY`, `DELETE FROM sys_login_log WHERE created_at < NOW() - INTERVAL ${logDays} DAY`],
];

for (const [label, cntSql, delSql] of jobs) {
  const [rows] = await conn.query(cntSql);
  const { n, mb } = rows[0];
  console.log(`${label}: ${n} 行${mb ? ` (${mb}MB)` : ''}${yes ? '' : ' [dry-run]'}`);
  if (yes && Number(n) > 0) {
    const [r] = await conn.query(delSql);
    console.log(`  已删除 ${r.affectedRows} 行`);
  }
}
await conn.end();
console.log(yes ? 'OK 清理完成' : 'dry-run 结束（加 --yes 执行删除）');
