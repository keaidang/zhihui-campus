// /api/dorm — 宿舍管理（楼栋/房间/住宿分配；报修走 /api/af/repair 复用）
// GET  ?view=overview  全部楼栋+房间（含入住进度；admin/counselor）
//      ?view=my        我的宿舍（学生：楼栋/房间/室友/床位）
//      ?view=students  未入住学生清单（admin/counselor，分配下拉用）
// POST { action: 'addBuilding' | 'addRoom' | 'toggleRoom' | 'assign' | 'unassign' }
//   assign/unassign 在事务内维护 dorm_room.occupied；性别约束：男入男寝、女入女寝
import { ok, fail, jsonError, readBody, preflight, clientIp } from '../../lib/http.js';
import { requireRoles, opLog } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';
import { isGenderMatch } from '../../lib/dorm-rules.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const url = new URL(context.request.url);
    const view = url.searchParams.get('view') || 'overview';
    const isStaff = roles.some((r) => ['admin', 'counselor'].includes(r));
    // 楼栋/房间总览与未入住学生清单是管理数据，仅 staff 可见；学生走 view=my
    if (view !== 'my' && !isStaff) return fail(40301, '暂无权限查看宿舍管理数据', 403);

    if (view === 'my') {
      // 我的宿舍：在住分配 → 房间 → 楼栋 + 室友
      const mine = await query(
        `SELECT da.id AS assignId, da.bed_no AS bedNo, da.check_in_at AS checkInAt,
                dr.id AS roomId, dr.room_no AS roomNo, dr.capacity,
                db.id AS buildingId, db.name AS buildingName, db.gender
           FROM dorm_assignment da
           JOIN dorm_room dr ON dr.id = da.room_id
           JOIN dorm_building db ON db.id = dr.building_id
          WHERE da.user_id = ? AND da.check_out_at IS NULL`,
        [userId],
      );
      let roommates = [];
      if (mine.length > 0) {
        roommates = await query(
          `SELECT u.real_name AS realName, u.username, u.user_no AS userNo, u.gender, da.bed_no AS bedNo
             FROM dorm_assignment da JOIN sys_user u ON u.id = da.user_id
            WHERE da.room_id = ? AND da.check_out_at IS NULL AND da.user_id <> ?
            ORDER BY da.bed_no`,
          [mine[0].roomId, userId],
        );
      }
      return ok({ dorm: mine[0] || null, roommates });
    }

    if (view === 'students') {
      // 未入住/可重新分配的学生（含性别与班级，供分配下拉）
      const rows = await query(
        `SELECT u.id, u.real_name AS realName, u.username, u.user_no AS userNo, u.gender,
                c.name AS className, d.name AS deptName
           FROM sys_user u
           JOIN sys_user_role ur ON ur.user_id = u.id
           JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student'
           LEFT JOIN sys_class c ON c.id = u.class_id
           LEFT JOIN sys_department d ON d.id = u.dept_id
          WHERE u.status = 1
            AND NOT EXISTS (SELECT 1 FROM dorm_assignment da WHERE da.user_id = u.id AND da.check_out_at IS NULL)
          ORDER BY u.user_no LIMIT 500`,
      );
      return ok({ list: rows });
    }

    // overview：楼栋 + 房间网格
    const buildings = await query(
      `SELECT b.id, b.name, b.gender, b.floors, b.note,
              COUNT(r.id) AS roomCount,
              COALESCE(SUM(r.capacity), 0) AS bedTotal,
              COALESCE(SUM(r.occupied), 0) AS bedUsed
         FROM dorm_building b
         LEFT JOIN dorm_room r ON r.building_id = b.id AND r.status = 1
        GROUP BY b.id ORDER BY b.name`,
    );
    const rooms = await query(
      `SELECT r.id, r.building_id AS buildingId, r.room_no AS roomNo, r.floor, r.capacity, r.occupied, r.status,
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', da.user_id, 'realName', u.real_name, 'username', u.username, 'userNo', u.user_no, 'bedNo', da.bed_no))
                   FROM dorm_assignment da JOIN sys_user u ON u.id = da.user_id
                  WHERE da.room_id = r.id AND da.check_out_at IS NULL) AS residents
         FROM dorm_room r ORDER BY r.building_id, r.room_no`,
    );
    // mysql2 对 JSON 类型（含 JSON_ARRAYAGG）自动解析为对象：有人住=数组，空房=NULL
    const normalize = (v) => (v == null ? [] : typeof v === 'string' ? JSON.parse(v) : v);
    return ok({
      buildings,
      rooms: rooms.map((r) => ({ ...r, residents: normalize(r.residents) })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    // 角色白名单已由 requireRoles 第二参兜住，故不需再取 roles
    const { userId } = await requireRoles(context, ['admin', 'counselor']);
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || '');

    if (action === 'addBuilding') {
      const name = String(body.name || '').trim().slice(0, 32);
      const gender = body.gender === 'female' ? 'female' : 'male';
      const floors = Math.min(Math.max(Number(body.floors) || 6, 1), 30);
      if (!name) return fail(49201, '请填写楼栋名称');
      const dup = await query('SELECT id FROM dorm_building WHERE name = ?', [name]);
      if (dup.length > 0) return fail(49202, '楼栋已存在');
      const r = await query('INSERT INTO dorm_building (name, gender, floors, note) VALUES (?, ?, ?, ?)', [
        name, gender, floors, String(body.note || '').trim().slice(0, 128),
      ]);
      await opLog(userId, 'dorm.addBuilding', `building:${r.insertId}`, name, ip);
      return ok({ id: r.insertId }, '楼栋已创建');
    }

    if (action === 'addRoom') {
      const buildingId = Number(body.buildingId);
      const roomNo = String(body.roomNo || '').trim().slice(0, 16);
      const floor = Math.min(Math.max(Number(body.floor) || 1, 1), 30);
      const capacity = Math.min(Math.max(Number(body.capacity) || 4, 1), 12);
      if (!buildingId || !roomNo) return fail(49201, '请选择楼栋并填写房号');
      const b = await query('SELECT id FROM dorm_building WHERE id = ?', [buildingId]);
      if (b.length === 0) return fail(49204, '楼栋不存在');
      const dup = await query('SELECT id FROM dorm_room WHERE building_id = ? AND room_no = ?', [buildingId, roomNo]);
      if (dup.length > 0) return fail(49202, '该房号已存在');
      const r = await query(
        'INSERT INTO dorm_room (building_id, room_no, floor, capacity) VALUES (?, ?, ?, ?)',
        [buildingId, roomNo, floor, capacity],
      );
      await opLog(userId, 'dorm.addRoom', `room:${r.insertId}`, `${buildingId}栋${roomNo}`, ip);
      return ok({ id: r.insertId }, '房间已创建');
    }

    if (action === 'toggleRoom') {
      const id = Number(body.id);
      const rooms = await query('SELECT id, status, occupied FROM dorm_room WHERE id = ?', [id]);
      if (rooms.length === 0) return fail(49204, '房间不存在');
      if (rooms[0].status === 1 && rooms[0].occupied > 0) return fail(49205, '房间有住户，先退宿后再停用');
      const next = rooms[0].status === 1 ? 0 : 1;
      await query('UPDATE dorm_room SET status = ? WHERE id = ?', [next, id]);
      await opLog(userId, 'dorm.toggleRoom', `room:${id}`, String(next), ip);
      return ok({ id, status: next }, next === 1 ? '已启用' : '已停用');
    }

    if (action === 'assign') {
      const roomId = Number(body.roomId);
      const targetId = Number(body.userId);
      if (!roomId || !targetId) return fail(49201, '参数缺失');
      const result = await withTransaction(async (conn) => {
        // 房间与楼栋锁定：容量 + 性别双重校验（FOR UPDATE 防并发超员）
        const [rooms] = await conn.query(
          `SELECT r.id, r.capacity, r.occupied, r.status, b.gender
             FROM dorm_room r JOIN dorm_building b ON b.id = r.building_id
            WHERE r.id = ? FOR UPDATE`,
          [roomId],
        );
        if (rooms.length === 0) throw Object.assign(new Error('房间不存在'), { code: 49204 });
        const room = rooms[0];
        if (room.status !== 1) throw Object.assign(new Error('房间已停用'), { code: 49205 });
        const [users] = await conn.query('SELECT id, gender, real_name FROM sys_user WHERE id = ?', [targetId]);
        if (users.length === 0) throw Object.assign(new Error('学生不存在'), { code: 49204 });
        const user = users[0];
        // 判定规则在 lib/dorm-rules.js（纯函数，tests/unit/dorm-rules.spec.js 覆盖）
        if (!isGenderMatch(user.gender, room.gender)) {
          throw Object.assign(new Error('性别与楼栋不符，禁止分配'), { code: 49203 });
        }
        if (room.occupied >= room.capacity) throw Object.assign(new Error('房间已满员'), { code: 49206 });
        // 已有在住记录则先拒绝（一人一床）
        const [exist] = await conn.query(
          'SELECT id FROM dorm_assignment WHERE user_id = ? AND check_out_at IS NULL',
          [targetId],
        );
        if (exist.length > 0) throw Object.assign(new Error('该学生已在住宿中'), { code: 49207 });
        // 最小可用床位号
        const [beds] = await conn.query(
          'SELECT COALESCE(MAX(bed_no), 0) + 1 AS next FROM dorm_assignment WHERE room_id = ? AND check_out_at IS NULL',
          [roomId],
        );
        const bedNo = beds[0].next;
        const [ins] = await conn.query(
          'INSERT INTO dorm_assignment (room_id, user_id, bed_no) VALUES (?, ?, ?)',
          [roomId, targetId, bedNo],
        );
        await conn.query('UPDATE dorm_room SET occupied = occupied + 1 WHERE id = ?', [roomId]);
        return { assignId: ins.insertId, bedNo };
      });
      await opLog(userId, 'dorm.assign', `user:${targetId}`, `room:${roomId}/bed:${result.bedNo}`, ip);
      return ok(result, '已安排入住');
    }

    if (action === 'unassign') {
      const targetId = Number(body.userId);
      if (!targetId) return fail(49201, '参数缺失');
      const result = await withTransaction(async (conn) => {
        const [rows] = await conn.query(
          'SELECT id, room_id FROM dorm_assignment WHERE user_id = ? AND check_out_at IS NULL FOR UPDATE',
          [targetId],
        );
        if (rows.length === 0) throw Object.assign(new Error('该学生无在住记录'), { code: 49204 });
        await conn.query('UPDATE dorm_assignment SET check_out_at = NOW() WHERE id = ?', [rows[0].id]);
        await conn.query('UPDATE dorm_room SET occupied = GREATEST(occupied - 1, 0) WHERE id = ?', [rows[0].room_id]);
        return { roomId: rows[0].room_id };
      });
      await opLog(userId, 'dorm.unassign', `user:${targetId}`, `room:${result.roomId}`, ip);
      return ok(result, '已办理退宿');
    }

    return fail(49201, '不支持的操作');
  } catch (e) {
    if (e && e.code >= 49200 && e.code <= 49299) {
      return fail(e.code, e.message);
    }
    return jsonError(e);
  }
}
