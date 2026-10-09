// /api/af/notice — 公告（HTTP 薄壳）
// GET  全校公告 + 本院公告（staff 可见全部）
// POST { action: 'publish' | 'revoke' | 'pin' }  发布者: teacher/counselor/admin
//
// ★ P4 服务层重构（2026-10-09）：业务逻辑已全部移入 lib/services/notice.js，
//   本文件只负责「解析 HTTP → 构造 actor → 调 service → 包装响应」。
//   这样 AI 对话触发（lib/ai-actions.js）与人工点按钮走的是**同一份**权限与审计代码。
import { ok, jsonError, readBody, preflight } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { handleNoticeAction, listNotices } from '../../lib/services/notice.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const actor = await actorFrom(context);
    const url = new URL(context.request.url);
    const r = await listNotices(actor, {
      page: url.searchParams.get('page') || 1,
      pageSize: url.searchParams.get('pageSize') || 10,
    });
    return ok(r.data);
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context, ['teacher', 'counselor', 'admin']);
    const body = await readBody(context.request);
    const r = await handleNoticeAction(actor, body);
    return ok(r.data, r.message);
  } catch (e) {
    return jsonError(e);
  }
}
