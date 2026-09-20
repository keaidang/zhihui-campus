// scripts/seed-dorm.mjs — 宿舍管理测试数据（幂等：可重复执行）
//  1. 为全体学生补齐性别（确定性：按 user_id 奇偶，重跑结果一致）
//  2. 为 8 栋楼生成房间（6 层 × 每层 8 间，4 人间为主、部分 6 人间）
//  3. 把所有未住宿的学生按性别分配进对应楼栋房间（每间填满为止，保留少量空位）
// 用法：node scripts/seed-dorm.mjs
import mysql from 'mysql2/promise';
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
    });
  } catch (e) {
    console.log(`连接失败（第 ${i + 1} 次）：${e.code || e.message}，8s 后重试…`);
    await new Promise((s) => setTimeout(s, 8000));
  }
}
if (!conn) { console.error('多次重试后仍无法连接数据库'); process.exit(1); }

const q = async (sql, params) => (await conn.query(sql, params))[0];

// ---------- 1. 性别补齐（确定性：id 奇偶 → 男/女，重跑不变） ----------
await conn.query(
  `UPDATE sys_user u
      JOIN sys_user_role ur ON ur.user_id = u.id
      JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student'
     SET u.gender = IF(u.id % 2 = 1, 1, 2)
    WHERE u.gender = 0`,
);
const genderStat = await q(
  `SELECT u.gender, COUNT(*) n FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student'
    WHERE u.status = 1 GROUP BY u.gender`,
);
console.log('性别分布:', genderStat.map((g) => ({ gender: g.gender, n: Number(g.n) })));

// ---------- 2. 房间生成（幂等：唯一键冲突即跳过） ----------
const buildings = await q('SELECT id, name, gender FROM dorm_building ORDER BY name');
let roomsCreated = 0;
for (const b of buildings) {
  for (let floor = 1; floor <= 6; floor++) {
    for (let no = 1; no <= 8; no++) {
      const roomNo = `${floor}${String(no).padStart(2, '0')}`; // 101..608
      const capacity = no % 4 === 0 ? 6 : 4; // 每 4 间出 1 个 6 人间
      try {
        await conn.query(
          'INSERT INTO dorm_room (building_id, room_no, floor, capacity) VALUES (?, ?, ?, ?)',
          [b.id, roomNo, floor, capacity],
        );
        roomsCreated++;
      } catch (e) {
        if (e.errno !== 1062) throw e; // 1062 重复 = 已存在
      }
    }
  }
}
console.log(`房间：新建 ${roomsCreated} 间`);

// ---------- 3. 学生分配（幂等：已在住的跳过；内存中成批分配，写回最小化） ----------
const unassigned = await q(
  `SELECT u.id, u.gender FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student'
    WHERE u.status = 1
      AND NOT EXISTS (SELECT 1 FROM dorm_assignment da WHERE da.user_id = u.id AND da.check_out_at IS NULL)
    ORDER BY u.id`,
);
console.log(`待分配学生: ${unassigned.length}`);

// 按性别把房间装入内存（roomNo 顺序），优先填已住人数多的（集中住满）
let assigned = 0;
for (const want of ['male', 'female']) {
  const stuList = unassigned.filter((s) => (s.gender === 2 ? 'female' : 'male') === want);
  if (stuList.length === 0) continue;
  const rooms = await q(
    `SELECT r.id, r.capacity, r.occupied FROM dorm_room r
       JOIN dorm_building b ON b.id = r.building_id
      WHERE b.gender = ? AND r.status = 1
      ORDER BY (r.occupied / r.capacity) DESC, r.id`,
    [want],
  );
  const memRooms = rooms.map((r) => ({ id: r.id, capacity: r.capacity, occupied: Number(r.occupied), dirty: false }));
  const inserts = [];
  let idx = 0;
  for (const stu of stuList) {
    while (idx < memRooms.length && memRooms[idx].occupied >= memRooms[idx].capacity) idx++;
    if (idx >= memRooms.length) { console.log(`  ⚠ ${want} 床位不足，剩余 ${stuList.length - stuList.indexOf(stu)} 人未分配`); break; }
    const room = memRooms[idx];
    inserts.push([room.id, stu.id, room.occupied + 1]); // bed_no = 顺序号
    room.occupied += 1;
    room.dirty = true;
    assigned++;
  }
  // 批量写库：单条多值 INSERT + 逐房间 UPDATE（仅脏房间）
  for (let i = 0; i < inserts.length; i += 100) {
    const chunk = inserts.slice(i, i + 100);
    const values = chunk.map(() => '(?, ?, ?)').join(', ');
    const params = chunk.flat();
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await conn.query(`INSERT INTO dorm_assignment (room_id, user_id, bed_no) VALUES ${values}`, params); break; }
      catch (e) {
        if (attempt === 2) throw e;
        if (e.code === 'PROTOCOL_CONNECTION_LOST' || e.fatal) {
          console.log('  连接断开，重连…');
          conn = await mysql.createConnection({
            host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
            password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
            ssl: { rejectUnauthorized: true }, connectTimeout: 20000,
          });
        } else throw e;
      }
    }
  }
  for (const room of memRooms.filter((r) => r.dirty)) {
    await conn.query('UPDATE dorm_room SET occupied = ? WHERE id = ?', [room.occupied, room.id]);
  }
}
console.log(`已分配住宿: ${assigned} 人`);

// ---------- 汇总 ----------
const occ = await q('SELECT COALESCE(SUM(capacity),0) total, COALESCE(SUM(occupied),0) used FROM dorm_room WHERE status = 1');
console.log(`床位: ${occ[0].used}/${occ[0].total}`);
await conn.end();
console.log('✅ 宿舍种子完成');
