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
    const actor = await actorFrom(context);
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
