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

/**
 * 请假状态的语义码 —— **唯一口径**。
 *
 * ★ 为什么要有它（2026-10-21 查实的事故）：
 *   `api/ai/briefing.js` 曾经自己写死一套 0-based 口径
 *   （0=待批 / 1=已批 / 2=驳回 / 3=销假），与本文件的 1-based 完全错位。
 *   真实数据分布 status=1:113 / 2:65 / 3:31 / 4:58 下，简报会把
 *   "审批中 113 条"报成"已批 113 条"、"已驳回 31 条"报成"已销假"，
 *   而 58 条已销假因为 status=4 根本没被计入任何一个 SUM —— 四个数字全错位。
 *   这类"数字看起来正常、含义整体平移"的缺陷最难被发现，故：
 *   **任何按请假状态统计的地方都必须 import 这里，禁止再写数字字面量。**
 */
export const LEAVE_CODE = { PENDING: 1, APPROVED: 2, REJECTED: 3, BACKED: 4 };

/**
 * 近 N 天请假状态统计（简报 / 看板等聚合场景复用）
 * @param {number} days 统计窗口（天），夹在 1~365
 * @returns {{sql: string, params: number[]}} 参数顺序与别名一一对应，调用方直接 query(sql, params)
 */
export function leaveStatsQuery(days = 7) {
  const d = Math.min(365, Math.max(1, Math.trunc(Number(days)) || 7));
  return {
    sql: `SELECT COUNT(*) AS total,
                 SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS pending,
                 SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS approved,
                 SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS rejected,
                 SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS done
            FROM af_leave
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${d} DAY)`,
    params: [LEAVE_CODE.PENDING, LEAVE_CODE.APPROVED, LEAVE_CODE.REJECTED, LEAVE_CODE.BACKED],
  };
}

/**
 * 请假审批的**节点定义** —— 唯一口径。
 *
 * 抽出常量的原因（2026-11-23）：此前建单 SQL 里硬编码了一行"辅导员审批"，
 * 于是 flow_node 表结构虽支持多节点，实际永远只有 1 行 —— 论文 4.4 讲的
 * "申请人 → 辅导员 → 系主任 / 加签转办均为新增节点"根本无从落地，
 * 前端也画不出节点时间线。抽成常量后：① SQL 由它生成，不可能只插一个；
 * ② 单测可以直接断言节点数量与角色，改回单节点会立刻测试失败。
 *
 * 第二节点用 leader（院系/校级复核）：角色表里没有"系主任"这个 code，
 * 硬造角色要动整套权限体系；而论文强调的正是"处理人按角色 + 数据范围实时匹配"，
 * 用现有角色表达复核环节更贴合实现。
 */
export const LEAVE_NODES = [
  { order: 1, name: '辅导员审批', role: 'counselor' },
  { order: 2, name: '院系复核', role: 'leader' },
];

const STAFF = ['admin', 'counselor', 'teacher', 'leader'];
// 能进入审批入口的角色（具体能否批**当前节点**，由 flow_node.handler_role 决定，
// 见 decideLeave —— 这里只是粗筛，避免任意角色打到 43005 才发现不行）
const APPROVERS = ['counselor', 'leader', 'admin'];
const TYPES = ['事假', '病假', '其他'];
const MAX_DAYS = 30;

/**
 * 单条请假单对应的「流程种子」——纯函数，便于单测。
 *
 * ★ 为什么需要（2026-10-26 体检发现）：线上 283 条请假单里有 265 条 `instance_id` 为空
 *   （历史 seed 脚本直插 af_leave、不建流程），其中 113 条还停在"审批中"。
 *   这些单子点审批时，`UPDATE flow_node ... WHERE instance_id = NULL` 命中 0 行、
 *   `UPDATE flow_instance WHERE id = NULL` 也命中 0 行 —— 只有 af_leave.status 变了，
 *   **审批意见与处理人静默丢失，而且不报错**。故审批/销假前必须能就地补齐流程。
 *
 * 补录原则：不伪造审批痕迹 —— 已结束的单子只补"节点状态"，opinion 标注补录，
 * handler_id / handled_at 保持为空（宁可显示缺失，也不能编造是谁批的）。
 * @param {number} status af_leave.status：1 审批中 / 2 已批准 / 3 已驳回 / 4 已销假
 * @returns {{instStatus:number,nodeStatus:number,opinion:string}|null} 非法状态返回 null
 */
export function leaveFlowSeed(status) {
  const s = Number(status);
  const BACKFILL = '历史数据补录（无审批记录）';
  if (s === 1) return { instStatus: 1, nodeStatus: 0, opinion: '' };
  if (s === 2) return { instStatus: 2, nodeStatus: 1, opinion: BACKFILL };
  if (s === 3) return { instStatus: 3, nodeStatus: 2, opinion: BACKFILL };
  if (s === 4) return { instStatus: 4, nodeStatus: 1, opinion: BACKFILL };
  return null;
}

/**
 * 保证请假单有流程实例：缺则在同一事务内就地补建（幂等），返回 instanceId。
 * @param {object} conn 事务连接
 * @param {{id:number,status:number,instance_id:?number,student_id:number,dept_id:?number,type?:string}} leave
 * @returns {Promise<?number>} 补建或已有的 instanceId；状态非法时返回 null
 */
export async function ensureLeaveFlow(conn, leave) {
  if (leave.instance_id) return leave.instance_id;
  const seed = leaveFlowSeed(leave.status);
  if (!seed) return null;
  const [fi] = await conn.query(
    `INSERT INTO flow_instance (biz_type, biz_id, title, applicant_id, dept_id, status, current_node)
     VALUES ('leave', ?, ?, ?, ?, ?, 1)`,
    [leave.id, `${leave.type || '事假'}申请`, leave.student_id, leave.dept_id, seed.instStatus],
  );
  const nodeSql = LEAVE_NODES.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
  const nodeParams = LEAVE_NODES.flatMap((n) => [fi.insertId, n.order, n.name, n.role, seed.nodeStatus, seed.opinion]);
  await conn.query(
    `INSERT INTO flow_node (instance_id, node_order, node_name, handler_role, status, opinion) VALUES ${nodeSql}`,
    nodeParams,
  );
  await conn.query('UPDATE af_leave SET instance_id = ? WHERE id = ?', [fi.insertId, leave.id]);
  return fi.insertId;
}

/**
 * 请假单列表
 * 数据范围：学生本人 / 辅导员本院 / 校领导与超管全校（与 lib/guard.js 的 dataScope 一致）
 *
 * @param {object} [o]
 * @param {string|number} [o.status]  1 审批中 / 2 已批准 / 3 已驳回 / 4 已销假
 * @param {string} [o.keyword] 学生姓名/学号/账号关键字（**在 SQL 里过滤**）
 * @param {number[]} [o.ids]   指定单号（AI 目标解析用）
 * @param {number} [o.limit]   行数上限，默认 100，硬夹 500
 *
 * ★ keyword / ids 为什么必须下推到 SQL（2026-10-20 修复）：
 *   原实现固定 `LIMIT 100`，调用方（AI 的 query_leaves / 审批目标解析）再在
 *   **这 100 条**里做内存筛选。线上待审批有 113 条，于是最新的 13 条对 AI
 *   完全不可见 —— 用户点名某个学生，AI 也只会回"没有匹配到"。
 *   这与 users.js 的 findUsersByNames 是同一类坑（"分页后内存筛"），处理方式保持一致。
 */
export async function listLeaves(actor, { status, keyword, ids, limit } = {}) {
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
    } else if (scope.type !== 'all') {
      // ★★ 兜底：**绝不能不加条件**（2026-10-10 体检发现）。
      //   dataScope 会在"角色不在 admin/leader/counselor 里"或"辅导员 deptId 为空"时
      //   返回 {type:'self'}；原实现只写 `if (dept)`，于是 self 落到"不加限制 = 看全校"。
      //   实测：教师账号能拿到全校 100 条请假单。
      //   这里退化为"仅本人"——最保守，且与 dataScope 的 self 语义一致。
      where.push('l.student_id = ?');
      params.push(actor.userId);
    }
  }
  if (status && ['1', '2', '3', '4'].includes(String(status))) {
    where.push('l.status = ?');
    params.push(Number(status));
  }
  const kw = String(keyword || '').trim().slice(0, 32);
  if (kw) {
    where.push('(u.real_name LIKE ? OR u.user_no LIKE ? OR u.username LIKE ?)');
    const like = `%${kw}%`;
    params.push(like, like, like);
  }
  const idList = Array.isArray(ids) ? [...new Set(ids.map(Number).filter(Boolean))].slice(0, 200) : [];
  if (idList.length) {
    where.push(`l.id IN (${idList.map(() => '?').join(',')})`);
    params.push(...idList);
  }
  const maxRows = Math.min(500, Math.max(1, Number(limit) || 100));

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
      LIMIT ${maxRows}`,
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
    // ★ 两节点：辅导员初审 → 院系复核（2026-11-23 补实现）
    //
    // 为什么之前只有 1 个节点而论文写的是"多节点"：建单时硬编码只插 node_order=1，
    // 审批也只 UPDATE node_order=1 —— 于是 flow_node 表虽然"支持多节点"，
    // 实际永远只有一行，图 4-6 要的"节点时间线"根本画不出来，
    // 论文 4.4「加签、转办均为新增节点」也就无从验证。
    //
    // 第二节点用 leader（院系/校级复核）：角色表里没有"系主任"，
    // 硬造角色要改权限体系；而论文 4.4 强调的正是「处理人不固定为账号，
    // 按角色 + 数据范围实时匹配」——用现有角色表达复核环节，更贴合实现。
    const nodeSql = LEAVE_NODES.map(() => '(?, ?, ?, ?, 0)').join(',');
    const nodeParams = LEAVE_NODES.flatMap((n) => [fi.insertId, n.order, n.name, n.role]);
    await conn.query(
      `INSERT INTO flow_node (instance_id, node_order, node_name, handler_role, status) VALUES ${nodeSql}`,
      nodeParams,
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

  const leaves = await query('SELECT id, dept_id, student_id, status, instance_id, type FROM af_leave WHERE id = ?', [id]);
  if (leaves.length === 0) throw new HttpError(43004, '请假单不存在');
  const lv = leaves[0];
  if (lv.status !== 1) throw new HttpError(43002, '该申请不在审批中');
  if (hasRole(actor, ['counselor']) && !isAdmin(actor)) {
    if (!actor.deptId || lv.dept_id !== actor.deptId) throw new HttpError(40301, '只能审批本院学生的申请', 403);
  }

  const yes = Boolean(approve);
  let instanceId = lv.instance_id;
  let nextNodeName = ''; // 通过后是否还有下一节点，用于决定提示语

  await withTransaction(async (conn) => {
    // ★ 历史数据可能没有流程实例（见 leaveFlowSeed 注释）：就地补建，否则审批意见会静默丢失
    instanceId = await ensureLeaveFlow(conn, lv);
    if (!instanceId) throw new HttpError(43005, '该请假单缺少流程实例，请联系管理员');

    // ---- 按**当前节点**取处理规则（2026-11-23：从"写死 node_order=1"改为多节点推进）----
    const [instRows] = await conn.query(
      'SELECT id, current_node, status FROM flow_instance WHERE id = ? FOR UPDATE',
      [instanceId],
    );
    if (instRows.length === 0) throw new HttpError(43005, '流程实例不存在');
    const curOrder = Number(instRows[0].current_node) || 1;

    const [curNodes] = await conn.query(
      'SELECT node_order, node_name, handler_role, status FROM flow_node WHERE instance_id = ? AND node_order = ?',
      [instanceId, curOrder],
    );
    if (curNodes.length === 0) throw new HttpError(43005, `当前节点（第 ${curOrder} 步）不存在`);
    const curNode = curNodes[0];
    if (Number(curNode.status) !== 0) throw new HttpError(43002, `「${curNode.node_name}」已处理过，请刷新`);

    // 处理人按「角色 + 数据范围」实时匹配，而不是写死某个账号
    if (!isAdmin(actor) && !hasRole(actor, [curNode.handler_role])) {
      throw new HttpError(40301, `当前环节为「${curNode.node_name}」，你的角色无权处理`, 403);
    }
    // 辅导员这一环仍限本院（与数据范围口径一致）
    if (hasRole(actor, ['counselor']) && !isAdmin(actor)) {
      if (!actor.deptId || lv.dept_id !== actor.deptId) throw new HttpError(40301, '只能审批本院学生的申请', 403);
    }

    const [nodeUpd] = await conn.query(
      'UPDATE flow_node SET status = ?, handler_id = ?, opinion = ?, handled_at = NOW() WHERE instance_id = ? AND node_order = ? AND status = 0',
      [yes ? 1 : 2, actor.userId, op || (yes ? '同意' : '驳回'), instanceId, curOrder],
    );
    if (nodeUpd.affectedRows === 0) throw new HttpError(43005, '该审批节点异常（已被处理或不存在）');

    // ---- 驳回：整单结束，后续节点标记为「流程终止」，时间线上不留悬空待办 ----
    if (!yes) {
      await conn.query(
        `UPDATE flow_node SET status = 2, opinion = '（前序节点驳回，流程终止）'
          WHERE instance_id = ? AND node_order > ? AND status = 0`,
        [instanceId, curOrder],
      );
      await conn.query('UPDATE flow_instance SET status = 3, updated_at = NOW() WHERE id = ?', [instanceId]);
      await conn.query('UPDATE af_leave SET status = 3 WHERE id = ?', [id]);
      return;
    }

    // ---- 通过：看还有没有下一节点 ----
    const [nextRows] = await conn.query(
      'SELECT node_order, node_name FROM flow_node WHERE instance_id = ? AND node_order > ? AND status = 0 ORDER BY node_order LIMIT 1',
      [instanceId, curOrder],
    );
    if (nextRows.length > 0) {
      // 还有下一环：只前进，不结单，单据仍为「审批中」
      await conn.query('UPDATE flow_instance SET current_node = ?, updated_at = NOW() WHERE id = ?', [
        nextRows[0].node_order,
        instanceId,
      ]);
      nextNodeName = nextRows[0].node_name;
      return;
    }
    // 最后一环：整单批准
    await conn.query('UPDATE flow_instance SET status = 2, updated_at = NOW() WHERE id = ?', [instanceId]);
    await conn.query('UPDATE af_leave SET status = 2 WHERE id = ?', [id]);
  });

  // 站内通知（尽力而为，失败不影响审批结果）
  if (nextNodeName) {
    // 流转到下一节点：先告知学生会继续审核，避免"批了却还没结束"的困惑
    await notify(
      lv.student_id,
      `你的请假申请已通过「辅导员审批」，正在流转至「${nextNodeName}」`,
      `你的请假申请已通过上一环节${op ? `，意见：${op}` : ''}，当前等待「${nextNodeName}」处理，请留意通知。`,
      { senderId: actor.userId, biz: 'leave' },
    );
  } else {
    await notify(
      lv.student_id,
      yes ? '你的请假申请已批准' : '你的请假申请被驳回',
      yes
        ? `你的请假申请已通过全部审批环节${op ? `，意见：${op}` : ''}。请按时返校并在返校后完成销假。`
        : `你的请假申请未通过${op ? `，原因：${op}` : ''}。如有疑问请联系辅导员。`,
      { senderId: actor.userId, biz: 'leave' },
    );
  }

  const done = !nextNodeName;
  await opLog(actor.userId, `leave.${yes ? 'approve' : 'reject'}`, `leave:${id}`, auditDetail(actor, op), actor.ip);
  return {
    data: { leaveId: id, status: done ? (yes ? 2 : 3) : 1, nextNode: nextNodeName || null },
    message: !yes ? '已驳回' : nextNodeName ? `已通过，流转至「${nextNodeName}」` : '已批准',
  };
}

/**
 * 请假单详情（含**完整节点时间线**）
 *
 * 为什么单独一个接口而不是复用列表：
 *   列表为了轻量只 JOIN 了 `current_node` 那一行节点（用于显示"当前环节"），
 *   而详情页要画「申请人 → 辅导员 → 院系复核」的完整时间线，
 *   需要按 node_order 取全部节点（含已处理节点的意见与时间）。
 *   把 nodes 塞进列表会让每行 100 条 × N 节点，列表接口明显变重。
 *
 * 数据范围与 listLeaves 完全同源（dataScope），不另写一套判断。
 */
export async function getLeaveDetail(actor, leaveId) {
  const id = Number(leaveId);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(43004, '请假单不存在');

  const rows = await query(
    `SELECT l.id, l.student_id, l.dept_id, l.type, l.reason, l.start_at, l.end_at, l.status,
            l.created_at, l.instance_id,
            u.real_name, u.username, u.user_no,
            d.name AS dept_name, c.name AS class_name,
            fi.status AS inst_status, fi.current_node
       FROM af_leave l
       JOIN sys_user u ON u.id = l.student_id
       LEFT JOIN sys_department d ON d.id = l.dept_id
       LEFT JOIN sys_class c ON c.id = u.class_id
       LEFT JOIN flow_instance fi ON fi.id = l.instance_id
      WHERE l.id = ?`,
    [id],
  );
  if (rows.length === 0) throw new HttpError(43004, '请假单不存在');
  const lv = rows[0];

  // 数据范围：学生本人 / 辅导员本院 / 校领导与超管全校
  const scope = dataScope(actor.roles, actor.deptId);
  if (scope.type === 'dept') {
    if (Number(lv.dept_id) !== Number(scope.deptId)) throw new HttpError(40301, '只能查看本院学生的申请', 403);
  } else if (scope.type !== 'all') {
    if (Number(lv.student_id) !== Number(actor.userId)) throw new HttpError(40301, '只能查看自己的申请', 403);
  }

  const nodes = lv.instance_id
    ? await query(
        `SELECT fn.node_order, fn.node_name, fn.handler_role, fn.status, fn.opinion, fn.handled_at,
                hu.real_name AS handler_name
           FROM flow_node fn
           LEFT JOIN sys_user hu ON hu.id = fn.handler_id
          WHERE fn.instance_id = ?
          ORDER BY fn.node_order`,
        [lv.instance_id],
      )
    : [];

  return {
    data: {
      ...lv,
      nodes: nodes.map((n) => ({
        order: Number(n.node_order),
        name: n.node_name,
        role: n.handler_role,
        // 0 待处理 / 1 通过 / 2 驳回
        status: Number(n.status),
        opinion: n.opinion || '',
        handlerName: n.handler_name || '',
        handledAt: n.handled_at || null,
        // 是否"当前停留节点"：前端据此高亮
        current: Number(n.node_order) === Number(lv.current_node) && Number(n.status) === 0,
      })),
    },
  };
}

/** 销假：学生本人，已批准 → 已销假 */
export async function backLeave(actor, leaveId) {
  const id = Number(leaveId);
  const leaves = await query('SELECT id, student_id, status, instance_id, dept_id, type FROM af_leave WHERE id = ?', [id]);
  if (leaves.length === 0) throw new HttpError(43004, '请假单不存在');
  if (leaves[0].student_id !== actor.userId) throw new HttpError(40301, '只能销自己的假', 403);
  if (leaves[0].status !== 2) throw new HttpError(43003, '仅已批准的请假单可销假');
  await withTransaction(async (conn) => {
    // 同上：老数据可能缺实例，销假前补齐，避免 flow_instance 静默漏更新
    const instanceId = await ensureLeaveFlow(conn, leaves[0]);
    if (!instanceId) throw new HttpError(43005, '该请假单缺少流程实例，请联系管理员');
    await conn.query('UPDATE af_leave SET status = 4, back_at = NOW() WHERE id = ?', [id]);
    await conn.query('UPDATE flow_instance SET status = 4, updated_at = NOW() WHERE id = ?', [instanceId]);
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
