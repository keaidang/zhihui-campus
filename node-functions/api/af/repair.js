// /api/af/repair — 宿舍报修
// GET  普通用户: 本人工单; admin/counselor: 全部工单（可按状态筛）
// POST { action: 'create' | 'accept' | 'finish', ... }
import { ok, fail, jsonError, readBody, preflight, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { notify } from '../../lib/notify.js';

export { preflight as onRequestOptions };

const STATUS = { 0: '待受理', 1: '处理中', 2: '已完成' };
const CATEGORY = ['水电', '家具', '网络', '门锁', '其他'];

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
    if (status !== null && ['0', '1', '2'].includes(status)) {
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

    // 受理/完成：辅导员或超管
    if (action === 'accept' || action === 'finish') {
      if (!roles.some((r) => ['admin', 'counselor'].includes(r))) throw ERR_FORBIDDEN('仅辅导员/管理员可处理工单');
      const id = Number(body.id);
      const rows = await query('SELECT id, status FROM af_repair WHERE id = ?', [id]);
      if (rows.length === 0) return fail(44004, '工单不存在');
      const remark = String(body.remark || '').trim().slice(0, 256);
      if (action === 'accept') {
        if (rows[0].status !== 0) return fail(44002, '该工单已受理');
        await query('UPDATE af_repair SET status = 1, handler_id = ?, remark = ? WHERE id = ?', [userId, remark, id]);
      } else {
        if (rows[0].status !== 1) return fail(44003, '仅处理中的工单可完成');
        await query('UPDATE af_repair SET status = 2, handler_id = ?, remark = ? WHERE id = ?', [userId, remark, id]);
      }
      await opLog(userId, `repair.${action}`, `repair:${id}`, remark, ip);
      // 站内通知：受理/完成进度推送给报修人
      const owner = await query('SELECT user_id, location FROM af_repair WHERE id = ?', [id]);
      await notify(
        owner[0]?.user_id,
        action === 'accept' ? '你的报修工单已受理' : '你的报修工单已完成',
        action === 'accept'
          ? `你提交的「${owner[0]?.location || ''}」报修已被受理${remark ? `，备注：${remark}` : ''}，师傅会尽快上门处理。`
          : `你提交的「${owner[0]?.location || ''}」报修已完成${remark ? `，备注：${remark}` : ''}，请确认。`,
        { senderId: userId, biz: 'repair' },
      );
      return ok({ id, status: action === 'accept' ? 1 : 2 }, action === 'accept' ? '已受理' : '工单已完成');
    }

    return fail(44001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
