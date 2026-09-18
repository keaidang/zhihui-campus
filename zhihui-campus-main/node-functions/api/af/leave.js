// /api/af/leave — 请销假（审批流驱动: flow_instance + flow_node）
// GET  学生: 本人请假单; counselor/admin/leader: 本院/全校单据
// POST { action: 'apply' | 'approve' | 'reject' | 'back', ... }
import { ok, fail, jsonError, readBody, preflight, clientIp } from '../../lib/http.js';
import { requireRoles, dataScope, ERR_FORBIDDEN, opLog } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';

export { preflight as onRequestOptions };

const STATUS = { 1: '审批中', 2: '已批准', 3: '已驳回', 4: '已销假' };

export async function onRequestGet(context) {
  try {
    const { userId, roles, deptId } = await requireRoles(context);
    const url = new URL(context.request.url);
    const status = url.searchParams.get('status');

    const isStudentOnly = !roles.some((r) => ['admin', 'counselor', 'teacher', 'leader'].includes(r));
    const where = ['1 = 1'];
    const params = [];
    if (isStudentOnly) {
      where.push('l.student_id = ?');
      params.push(userId);
    } else {
      const scope = dataScope(roles, deptId);
      if (scope.type === 'dept') {
        where.push('l.dept_id = ?');
        params.push(scope.deptId);
      }
    }
    if (status && ['1', '2', '3', '4'].includes(status)) {
      where.push('l.status = ?');
      params.push(Number(status));
    }

    const rows = await query(
      `SELECT l.id, l.type, l.reason, l.start_at, l.end_at, l.status, l.back_at, l.created_at,
              u.real_name, u.user_no, u.username, d.name AS dept_name, cl.name AS class_name,
              fn.opinion, fn.handled_at
         FROM af_leave l
         JOIN sys_user u ON u.id = l.student_id
         LEFT JOIN sys_department d ON d.id = l.dept_id
         LEFT JOIN sys_class cl ON cl.id = u.class_id
         LEFT JOIN flow_instance fi ON fi.biz_type = 'leave' AND fi.biz_id = l.id
         LEFT JOIN flow_node fn ON fn.instance_id = fi.id AND fn.node_order = fi.current_node
        WHERE ${where.join(' AND ')}
        ORDER BY l.id DESC
        LIMIT 100`,
      params,
    );
    return ok({ list: rows.map((r) => ({ ...r, status_text: STATUS[r.status] })) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId, roles, deptId } = await requireRoles(context);
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || '');

    // 学生申请：建单 + 建流程实例 + 建辅导员审批节点
    if (action === 'apply') {
      const type = ['事假', '病假', '其他'].includes(body.type) ? body.type : '事假';
      const reason = String(body.reason || '').trim().slice(0, 500);
      const startAt = String(body.startAt || '').slice(0, 19);
      const endAt = String(body.endAt || '').slice(0, 19);
      if (!reason) return fail(43001, '请填写请假事由');
      const start = new Date(startAt.replace(' ', 'T'));
      const end = new Date(endAt.replace(' ', 'T'));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return fail(43001, '请假时间不合法（结束须晚于开始）');
      }
      if (end - start > 30 * 24 * 3600 * 1000) return fail(43001, '单次请假不能超过 30 天');

      let leaveId = null;
      await withTransaction(async (conn) => {
        const [ins] = await conn.query(
          'INSERT INTO af_leave (student_id, dept_id, type, reason, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, deptId, type, reason, startAt, endAt],
        );
        leaveId = ins.insertId;
        const [fi] = await conn.query(
          `INSERT INTO flow_instance (biz_type, biz_id, title, applicant_id, dept_id, status, current_node)
           VALUES ('leave', ?, ?, ?, ?, 1, 1)`,
          [leaveId, `${type}申请`, userId, deptId],
        );
        await conn.query(
          `INSERT INTO flow_node (instance_id, node_order, node_name, handler_role, status)
           VALUES (?, 1, '辅导员审批', 'counselor', 0)`,
          [fi.insertId],
        );
        await conn.query('UPDATE af_leave SET instance_id = ? WHERE id = ?', [fi.insertId, leaveId]);
      });
      return ok({ leaveId }, '请假申请已提交，等待辅导员审批');
    }

    // 审批（通过/驳回）：辅导员（本院）或超管
    if (action === 'approve' || action === 'reject') {
      if (!roles.some((r) => ['counselor', 'admin'].includes(r))) throw ERR_FORBIDDEN('仅辅导员可审批');
      const leaveId = Number(body.leaveId);
      const opinion = String(body.opinion || '').trim().slice(0, 256);
      const leaves = await query('SELECT id, dept_id, status, instance_id FROM af_leave WHERE id = ?', [leaveId]);
      if (leaves.length === 0) return fail(43004, '请假单不存在');
      const lv = leaves[0];
      if (lv.status !== 1) return fail(43002, '该申请不在审批中');
      if (roles.includes('counselor') && !roles.includes('admin')) {
        if (!deptId || lv.dept_id !== deptId) throw ERR_FORBIDDEN('只能审批本院学生的申请');
      }
      const approved = action === 'approve';
      await withTransaction(async (conn) => {
        await conn.query(
          'UPDATE flow_node SET status = ?, handler_id = ?, opinion = ?, handled_at = NOW() WHERE instance_id = ? AND node_order = 1 AND status = 0',
          [approved ? 1 : 2, userId, opinion || (approved ? '同意' : '驳回'), lv.instance_id],
        );
        await conn.query('UPDATE flow_instance SET status = ?, updated_at = NOW() WHERE id = ?', [approved ? 2 : 3, lv.instance_id]);
        await conn.query('UPDATE af_leave SET status = ? WHERE id = ?', [approved ? 2 : 3, leaveId]);
      });
      await opLog(userId, `leave.${action}`, `leave:${leaveId}`, opinion, ip);
      return ok({ leaveId, status: approved ? 2 : 3 }, approved ? '已批准' : '已驳回');
    }

    // 销假：学生本人，已批准 -> 已销假
    if (action === 'back') {
      const leaveId = Number(body.leaveId);
      const leaves = await query('SELECT id, student_id, status, instance_id FROM af_leave WHERE id = ?', [leaveId]);
      if (leaves.length === 0) return fail(43004, '请假单不存在');
      if (leaves[0].student_id !== userId) throw ERR_FORBIDDEN('只能销自己的假');
      if (leaves[0].status !== 2) return fail(43003, '仅已批准的请假单可销假');
      await withTransaction(async (conn) => {
        await conn.query('UPDATE af_leave SET status = 4, back_at = NOW() WHERE id = ?', [leaveId]);
        await conn.query('UPDATE flow_instance SET status = 4, updated_at = NOW() WHERE id = ?', [leaves[0].instance_id]);
      });
      return ok({ leaveId }, '销假成功，欢迎返校');
    }

    return fail(43001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
