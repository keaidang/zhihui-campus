// /api/af/repair — 宿舍报修（★ 单节点受理工单，状态机驱动）
//
// 模型定位（改业务前必读）：报修是"提交 → 受理 → 处理 → 完成"的**工单派办**，
//   只有受理人这一个处理环节、没有多节点审批语义，因此**不建 flow_instance/flow_node**。
//   审批流引擎当前仅请假接入（流程判据见 docs/DATABASE.md「审批流 vs 状态机」）。
//   ⚠ 历史上曾被误记为"存在 /api/dorm/repair 另一条写入路径 + 老接口会建流程实例"，
//     经核实两者均不存在——**全项目只有这一个报修写入端点**。
//
// 前端入口（均调本端点）：学生 /dorm（提交 + 我的工单）、staff /af/repair-manage（受理/完成/无法处理）
// GET  普通用户: 本人工单; admin/counselor: 全部工单（可按状态筛）
// POST { action: 'create' | 'accept' | 'finish' | 'reject', ... }
import { ok, fail, jsonError, readBody, preflight, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { notify } from '../../lib/notify.js';

export { preflight as onRequestOptions };

// 工单状态机：0 待受理 → 1 处理中 → 2 已完成；0/1 均可 → 3 无法处理（终态，需填原因）
const STATUS = { 0: '待受理', 1: '处理中', 2: '已完成', 3: '无法处理' };
const CATEGORY = ['水电', '家具', '网络', '门锁', '其他'];

// action → { from: 允许的前置状态, to: 目标状态, needRemark, msg }
// 约定：终态（2/3）不可再流转；"无法处理"与学生端可见的 remark（原因）强绑定
const FLOW = {
  accept: { from: [0], to: 1, needRemark: false, msg: '已受理' },
  finish: { from: [1], to: 2, needRemark: false, msg: '工单已完成' },
  reject: { from: [0, 1], to: 3, needRemark: true, msg: '已标记为无法处理' },
};

export async function onRequestGet(context) {
  try {
    const { userId, roles, deptId } = await requireRoles(context);
    const url = new URL(context.request.url);
    const status = url.searchParams.get('status');
    const staff = roles.some((r) => ['admin', 'counselor'].includes(r));

    const where = [];
    const params = [];
    if (!staff) {
      where.push('r.user_id = ?');
      params.push(userId);
    }
    if (status !== null && ['0', '1', '2', '3'].includes(status)) {
      where.push('r.status = ?');
      params.push(Number(status));
    }

    const rows = await query(
      `SELECT r.id, r.location, r.category, r.description, r.contact, r.status, r.remark,
              r.created_at, r.updated_at, u.real_name, u.username,
              h.real_name AS handler_name
         FROM af_repair r
         JOIN sys_user u ON u.id = r.user_id
         LEFT JOIN sys_user h ON h.id = r.handler_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY r.id DESC
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
    const { userId, roles } = await requireRoles(context);
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || '');

    if (action === 'create') {
      const location = String(body.location || '').trim().slice(0, 128);
      const description = String(body.description || '').trim().slice(0, 500);
      const contact = String(body.contact || '').trim().slice(0, 32);
      const category = CATEGORY.includes(body.category) ? body.category : '其他';
      if (!location) return fail(44001, '请填写报修位置');
      if (!description) return fail(44001, '请描述故障情况');
      const r = await query(
        'INSERT INTO af_repair (user_id, location, category, description, contact) VALUES (?, ?, ?, ?, ?)',
        [userId, location, category, description, contact],
      );
      return ok({ id: r.insertId }, '报修已提交，后勤会尽快受理');
    }

    // 受理 / 完成 / 无法处理：辅导员或超管（状态机流转，定义见文件头 FLOW）
    if (['accept', 'finish', 'reject'].includes(action)) {
      if (!roles.some((r) => ['admin', 'counselor'].includes(r))) throw ERR_FORBIDDEN('仅辅导员/管理员可处理工单');
      const step = FLOW[action];
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) return fail(44001, '工单参数不合法');

      const rows = await query('SELECT id, status, user_id, location FROM af_repair WHERE id = ?', [id]);
      if (rows.length === 0) return fail(44004, '工单不存在');
      const from = Number(rows[0].status);

      const remark = String(body.remark || '').trim().slice(0, 256);
      // "无法处理"必须说明原因：学生会收到该原因；留空则工单被关闭却无从解释
      if (step.needRemark && !remark) return fail(44006, '请填写无法处理的原因（会通知报修人）');

      // 条件更新：把允许的前置状态写进 WHERE，用受影响行数判定是否抢到
      // （防两名处理人对同一工单并发操作导致的越状态流转）
      const upd = await query(
        `UPDATE af_repair SET status = ?, handler_id = ?, remark = ?
          WHERE id = ? AND status IN (${step.from.map(() => '?').join(',')})`,
        [step.to, userId, remark, id, ...step.from],
      );
      if (upd.affectedRows === 0) {
        const cur = await query('SELECT status FROM af_repair WHERE id = ?', [id]);
        return fail(44005, `该工单当前为「${STATUS[Number(cur[0]?.status)] || '未知状态'}」，不能执行此操作`);
      }

      await opLog(userId, `repair.${action}`, `repair:${id}`, remark, ip);

      // 站内通知：状态变更推送给报修人（尽力而为，不阻断主业务）
      const loc = rows[0].location || '';
      const suffix = remark ? `，备注：${remark}` : '';
      const MSG = {
        accept: ['你的报修工单已受理', `你提交的「${loc}」报修已被受理${suffix}，师傅会尽快上门处理。`],
        finish: ['你的报修工单已完成', `你提交的「${loc}」报修已完成${suffix}，请确认。`],
        reject: [
          '你的报修工单无法处理',
          `你提交的「${loc}」报修经核实无法处理${suffix}。如有疑问请联系辅导员。`,
        ],
      };
      await notify(rows[0].user_id, MSG[action][0], MSG[action][1], { senderId: userId, biz: 'repair' });

      return ok({ id, status: step.to }, step.msg);
    }

    return fail(44001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
