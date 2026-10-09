// lib/services/leave.js — 请销假服务（从 api/af/leave.js 抽出）
//
// 审批流模型（保持一致，不要改成单节点状态机）：flow_instance + flow_node，
// 建单时同时建"辅导员审批"节点（node_order=1）。status: 1 审批中 / 2 已批准 / 3 已驳回 / 4 已销假。
//
// 调用方：api/af/leave.js（人工） + lib/ai-actions.js（AI 对话触发审批）
import { HttpError, dataScope, opLog } from '../guard.js';
import { query, withTransaction } from '../db.js';
import { notify } from '../notify.js';
import { auditDetail, hasRole, isAdmin } from './_actor.js';

export const LEAVE_STATUS = { 1: '审批中', 2: '已批准', 3: '已驳回', 4: '已销假' };

const STAFF = ['admin', 'counselor', 'teacher', 'leader'];
const APPROVERS = ['counselor', 'admin'];
const TYPES = ['事假', '病假', '其他'];
const MAX_DAYS = 30;

/**
 * 请假单列表
 * 数据范围：学生本人 / 辅导员本院 / 校领导与超管全校（与 lib/guard.js 的 dataScope 一致）
 */
export async function listLeaves(actor, { status } = {}) {
  const isStudentOnly = !hasRole(actor, STAFF);
  const where = ['1 = 1'];
  const params = [];
  if (isStudentOnly) {
    where.push('l.student_id = ?');
    params.push(actor.userId);
  } else {
    // ★ 刻意沿用 lib/guard.js 的 dataScope（而不是自己写 admin/leader/counselor 判断）：
    //   数据范围是全局口径，散落成第二份实现必然与 guard.js 漂移。
    const scope = dataScope(actor.roles, actor.deptId);
    if (scope.type === 'dept') {
      where.push('l.dept_id = ?');
      params.push(scope.deptId);
    }
  }
  if (status && ['1', '2', '3', '4'].includes(String(status))) {
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
  return { data: { list: rows.map((r) => ({ ...r, status_text: LEAVE_STATUS[r.status] })) }, message: 'ok' };
}

/** 北京墙钟字符串 → UTC Date（库内统一存 UTC，见铁律 #25） */
function toUtc(s) {
  const d = new Date(`${String(s || '').replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setTime(d.getTime() - 8 * 3600 * 1000);
  return d;
}

/** 学生提交请假申请：建单 + 建流程实例 + 建辅导员审批节点（同一事务） */
export async function applyLeave(actor, body = {}) {
  const type = TYPES.includes(body.type) ? body.type : '事假';
  const reason = String(body.reason || '').trim().slice(0, 500);
  const startAt = String(body.startAt || '').slice(0, 19);
  const endAt = String(body.endAt || '').slice(0, 19);
  if (!reason) throw new HttpError(43001, '请填写请假事由');

  const start = toUtc(startAt);
  const end = toUtc(endAt);
  if (!start || !end || end <= start) throw new HttpError(43001, '请假时间不合法（结束须晚于开始）');
  if (end - start > MAX_DAYS * 24 * 3600 * 1000) throw new HttpError(43001, `单次请假不能超过 ${MAX_DAYS} 天`);
  const startUtc = start.toISOString().slice(0, 19).replace('T', ' ');
  const endUtc = end.toISOString().slice(0, 19).replace('T', ' ');

  let leaveId = null;
  await withTransaction(async (conn) => {
    const [ins] = await conn.query(
      'INSERT INTO af_leave (student_id, dept_id, type, reason, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?)',
      [actor.userId, actor.deptId, type, reason, startUtc, endUtc],
    );
    leaveId = ins.insertId;
    const [fi] = await conn.query(
      `INSERT INTO flow_instance (biz_type, biz_id, title, applicant_id, dept_id, status, current_node)
       VALUES ('leave', ?, ?, ?, ?, 1, 1)`,
      [leaveId, `${type}申请`, actor.userId, actor.deptId],
    );
    await conn.query(
      `INSERT INTO flow_node (instance_id, node_order, node_name, handler_role, status)
       VALUES (?, 1, '辅导员审批', 'counselor', 0)`,
      [fi.insertId],
    );
    await conn.query('UPDATE af_leave SET instance_id = ? WHERE id = ?', [fi.insertId, leaveId]);
  });
  return { data: { leaveId }, message: '请假申请已提交，等待辅导员审批' };
}

/**
 * 审批（通过 / 驳回）：辅导员（本院）或超管
 * @param {Actor} actor
 * @param {{leaveId:number, approve:boolean, opinion?:string}} p
 */
export async function decideLeave(actor, { leaveId, approve, opinion = '' }) {
  if (!hasRole(actor, APPROVERS)) throw new HttpError(40301, '仅辅导员可审批', 403);
  const id = Number(leaveId);
  const op = String(opinion || '').trim().slice(0, 256);

  const leaves = await query('SELECT id, dept_id, student_id, status, instance_id FROM af_leave WHERE id = ?', [id]);
  if (leaves.length === 0) throw new HttpError(43004, '请假单不存在');
  const lv = leaves[0];
  if (lv.status !== 1) throw new HttpError(43002, '该申请不在审批中');
  if (hasRole(actor, ['counselor']) && !isAdmin(actor)) {
    if (!actor.deptId || lv.dept_id !== actor.deptId) throw new HttpError(40301, '只能审批本院学生的申请', 403);
  }

  const yes = Boolean(approve);
  await withTransaction(async (conn) => {
    await conn.query(
      'UPDATE flow_node SET status = ?, handler_id = ?, opinion = ?, handled_at = NOW() WHERE instance_id = ? AND node_order = 1 AND status = 0',
      [yes ? 1 : 2, actor.userId, op || (yes ? '同意' : '驳回'), lv.instance_id],
    );
    await conn.query('UPDATE flow_instance SET status = ?, updated_at = NOW() WHERE id = ?', [yes ? 2 : 3, lv.instance_id]);
    await conn.query('UPDATE af_leave SET status = ? WHERE id = ?', [yes ? 2 : 3, id]);
  });
  await opLog(actor.userId, `leave.${yes ? 'approve' : 'reject'}`, `leave:${id}`, auditDetail(actor, op), actor.ip);

  // 站内通知：审批结果推送给申请人（尽力而为，失败不影响审批结果）
  await notify(
    lv.student_id,
    yes ? '你的请假申请已批准' : '你的请假申请被驳回',
    yes
      ? `你的请假申请已通过审批${op ? `，意见：${op}` : ''}。请按时返校并在返校后完成销假。`
      : `你的请假申请未通过${op ? `，原因：${op}` : ''}。如有疑问请联系辅导员。`,
    { senderId: actor.userId, biz: 'leave' },
  );
  return { data: { leaveId: id, status: yes ? 2 : 3 }, message: yes ? '已批准' : '已驳回' };
}

/** 销假：学生本人，已批准 → 已销假 */
export async function backLeave(actor, leaveId) {
  const id = Number(leaveId);
  const leaves = await query('SELECT id, student_id, status, instance_id FROM af_leave WHERE id = ?', [id]);
  if (leaves.length === 0) throw new HttpError(43004, '请假单不存在');
  if (leaves[0].student_id !== actor.userId) throw new HttpError(40301, '只能销自己的假', 403);
  if (leaves[0].status !== 2) throw new HttpError(43003, '仅已批准的请假单可销假');
  await withTransaction(async (conn) => {
    await conn.query('UPDATE af_leave SET status = 4, back_at = NOW() WHERE id = ?', [id]);
    await conn.query('UPDATE flow_instance SET status = 4, updated_at = NOW() WHERE id = ?', [leaves[0].instance_id]);
  });
  return { data: { leaveId: id }, message: '销假成功，欢迎返校' };
}

/** 动作分发（handler 薄壳用） */
export async function handleLeaveAction(actor, body = {}) {
  const action = String(body.action || '');
  if (action === 'apply') return applyLeave(actor, body);
  if (action === 'approve' || action === 'reject') {
    return decideLeave(actor, { leaveId: body.leaveId, approve: action === 'approve', opinion: body.opinion });
  }
  if (action === 'back') return backLeave(actor, body.leaveId);
  throw new HttpError(43001, '不支持的操作');
}
