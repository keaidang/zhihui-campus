// 查最近 24h 的 error.500 与登录失败情况
import fs from 'node:fs';
import mysql from 'mysql2/promise';
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
  if (m) process.env[m[1]] = m[2];
}
const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: +process.env.DB_PORT,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, ssl: { rejectUnauthorized: true },
  // ★ 必须 'Z'：库内 DATETIME 一律为 UTC 墙钟（见 node-functions/lib/db.js 与 HANDOVER 铁律 #25）。
  //   曾误配 '+08:00'，会把 UTC 值当北京时间解读，任何时间输出/比较都会偏 8 小时。
  timezone: 'Z',
});
const [errs] = await conn.query(
  "SELECT action, LEFT(detail,120) d, COUNT(*) n FROM sys_op_log WHERE action='error.500' AND created_at > NOW() - INTERVAL 24 HOUR GROUP BY action, LEFT(detail,120) ORDER BY n DESC LIMIT 10",
);
console.log('近24h error.500 分组:', errs.length ? JSON.stringify(errs) : '无');
const [locks] = await conn.query(
  "SELECT COUNT(*) n FROM sys_login_log WHERE success=0 AND created_at > NOW() - INTERVAL 24 HOUR",
);
console.log('近24h 登录失败次数:', locks[0].n);
const [blobs] = await conn.query('SELECT COUNT(*) n, ROUND(SUM(size)/1048576,1) mb FROM sys_blob');
console.log('sys_blob 现状:', JSON.stringify(blobs[0]));
const [rt] = await conn.query('SELECT COUNT(*) n FROM sys_refresh_token');
console.log('sys_refresh_token 现存:', rt[0].n);
await conn.end();
