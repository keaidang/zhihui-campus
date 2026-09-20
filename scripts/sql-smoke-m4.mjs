// scripts/sql-smoke-m4.mjs — M4 新 API 的关键 SQL 冒烟（部署前对真实库验证，防 ER_BAD_FIELD_ERROR）
import fs from 'node:fs';
import mysql from 'mysql2/promise';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const conn = await mysql.createConnection({
  host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: true }, connectTimeout: 20000,
});
let pass = 0, failn = 0;
async function t(name, sql, params = []) {
  try {
    const [rows] = await conn.query(sql, params);
    pass++;
    console.log(`OK   ${name}  rows=${Array.isArray(rows) ? rows.length : 1}`);
    return rows;
  } catch (e) {
    failn++;
    console.log(`FAIL ${name} :: ${e.errno} ${e.sqlMessage}`);
  }
}

// dorm overview
await t('dorm.buildings', `SELECT b.id, b.name, b.gender, b.floors, b.note, COUNT(r.id) AS roomCount,
  COALESCE(SUM(r.capacity),0) AS bedTotal, COALESCE(SUM(r.occupied),0) AS bedUsed
  FROM dorm_building b LEFT JOIN dorm_room r ON r.building_id = b.id AND r.status = 1
  GROUP BY b.id ORDER BY b.name`);
await t('dorm.rooms', `SELECT r.id, r.building_id, r.room_no, r.capacity, r.occupied, r.status,
  (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', da.user_id, 'realName', u.real_name, 'bedNo', da.bed_no))
     FROM dorm_assignment da JOIN sys_user u ON u.id = da.user_id
    WHERE da.room_id = r.id AND da.check_out_at IS NULL) AS residents
  FROM dorm_room r ORDER BY r.building_id, r.room_no LIMIT 5`);
await t('dorm.my', `SELECT da.bed_no, dr.room_no, db.name FROM dorm_assignment da
  JOIN dorm_room dr ON dr.id = da.room_id JOIN dorm_building db ON db.id = dr.building_id
  WHERE da.user_id = ? AND da.check_out_at IS NULL`, [10144481]);
await t('dorm.students', `SELECT u.id, u.gender FROM sys_user u
  JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student'
  WHERE u.status = 1 AND NOT EXISTS (SELECT 1 FROM dorm_assignment da WHERE da.user_id = u.id AND da.check_out_at IS NULL) LIMIT 3`);

// messages
await t('msg.list', `SELECT m.id, m.read_at, s.real_name AS senderName FROM sys_message m
  LEFT JOIN sys_user s ON s.id = m.sender_id WHERE m.receiver_id = ? ORDER BY m.id DESC LIMIT 5`, [10144481]);
await t('msg.unread', 'SELECT COUNT(*) n FROM sys_message WHERE receiver_id = ? AND read_at IS NULL', [10144481]);
await t('msg.insert+read', `INSERT INTO sys_message (sender_id, receiver_id, type, biz, title, content)
  VALUES (0, ?, 'system', 'smoke', 'SQL冒烟测试', '可删除')`, [10144481]).then(async (r) => {
  const id = r.insertId;
  await t('msg.markRead', 'UPDATE sys_message SET read_at = NOW() WHERE id = ? AND receiver_id = ?', [id, 10144481]);
  await t('msg.delete', 'DELETE FROM sys_message WHERE id = ? AND receiver_id = ?', [id, 10144481]);
});
await t('msg.recipients', `SELECT u.id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
  JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student' WHERE u.status = 1 ORDER BY u.user_no LIMIT 600`);

// dashboard 21 queries（抽样关键 8 条）
await t('dash.roleCounts', `SELECT r.code, COUNT(*) n FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
  JOIN sys_user u ON u.id = ur.user_id AND u.status = 1 GROUP BY r.id`);
await t('dash.gender', `SELECT gender, COUNT(*) n FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
  JOIN sys_role r ON r.id = ur.role_id WHERE r.code = 'student' AND u.status = 1 GROUP BY gender`);
await t('dash.depts', `SELECT d.name, COUNT(*) n FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
  JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student' JOIN sys_department d ON d.id = u.dept_id
  WHERE u.status = 1 GROUP BY d.id ORDER BY n DESC`);
await t('dash.score', 'SELECT COUNT(*) n, ROUND(AVG(score),1) avg, MAX(score) max, MIN(score) min FROM edu_elect WHERE score IS NOT NULL');
await t('dash.dormBeds', 'SELECT COALESCE(SUM(r.capacity),0) total, COALESCE(SUM(r.occupied),0) used FROM dorm_room r WHERE r.status = 1');
await t('dash.club', `SELECT (SELECT COUNT(*) FROM club_application WHERE status = 0) pending,
  (SELECT COUNT(*) FROM club_recruit WHERE status = 1) recruiting,
  (SELECT COUNT(*) FROM club_booking WHERE canceled_at IS NULL) bookings`);
await t('dash.loginTrend', `SELECT DATE(created_at) d, COUNT(*) n FROM sys_login_log
  WHERE success = 1 AND created_at > NOW() - INTERVAL 7 DAY GROUP BY DATE(created_at) ORDER BY d`);
await t('dash.recentOps', `SELECT o.action, o.target, o.detail, o.created_at, u.real_name AS operator
  FROM sys_op_log o LEFT JOIN sys_user u ON u.id = o.operator_id ORDER BY o.id DESC LIMIT 10`);

console.log(`\n== SQL 冒烟: ${pass} 通过, ${failn} 失败 ==`);
await conn.end();
process.exit(failn > 0 ? 1 : 0);
