import mysql from 'mysql2/promise'; import fs from 'node:fs';
for (const line of fs.readFileSync('.env','utf8').split(/\r?\n/)) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
const conn = await mysql.createConnection({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, ssl: { rejectUnauthorized: true }, connectTimeout: 20000 });
const [rows] = await conn.query("SELECT id, email, code, used, expires_at, (expires_at < NOW()) AS expired, NOW() AS db_now, @@session.time_zone AS tz, @@global.time_zone AS gtz FROM sys_email_code ORDER BY id DESC LIMIT 3");
console.log(JSON.stringify(rows, null, 1));
await conn.end();
