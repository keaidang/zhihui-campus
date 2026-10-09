// /api/af/leave — 请销假（HTTP 薄壳，审批流驱动 flow_instance + flow_node）
// GET  学生: 本人请假单; counselor/admin/leader: 本院/全校单据
// POST { action: 'apply' | 'approve' | 'reject' | 'back', ... }
//
// ★ P4 服务层重构（2026-10-09）：业务逻辑在 lib/services/leave.js。
import { ok, jsonError, readBody, preflight } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { handleLeaveAction, listLeaves } from '../../lib/services/leave.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    // ★ 必须显式限定角色（2026-10-10 体检发现越权）：
    //   本文件头注释写的是"学生=本人 / counselor·admin·leader=本院或全校"，
    //   但代码此前只用 actorFrom(context)（仅要求登录），**注释与实现不符**。
    //   后果：教师账号 GET /api/af/leave 能拿到**全校 100 条请假单**
    //   （含学生姓名、学号、请假原因、审批意见）—— 实测确认。
    //   教师没有请假审批职能（前端菜单里"我的请假"仅 student 可见），
    //   所以这里直接拒绝，而不是让它退化成"看不到数据"。
    const actor = await actorFrom(context, ['student', 'counselor', 'admin', 'leader']);
    const url = new URL(context.request.url);
    const r = await listLeaves(actor, { status: url.searchParams.get('status') });
    return ok(r.data);
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context);
    const body = await readBody(context.request);
    const r = await handleLeaveAction(actor, body);
    return ok(r.data, r.message);
  } catch (e) {
    return jsonError(e);
  }
}
