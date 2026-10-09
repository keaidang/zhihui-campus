// /api/forum/threads — 论坛帖子（HTTP 薄壳；仅登录用户可访问，合规要求）
// GET  ?boardId=&keyword=&page=        帖子列表（置顶优先）
// GET  ?id=123                          帖子详情 + 回复列表
// POST { action: 'create' | 'reply' | 'edit' | 'delete' | 'pin' | 'lock' }
//
// ★ P4 服务层重构（2026-10-09）：业务逻辑在 lib/services/forum.js。
//   发帖/回复的 AI 审核钩子（P5）也统一挂在服务层，人工与 AI 路径共用。
import { ok, jsonError, preflight, readBody } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { getThread, handleThreadAction, listThreads } from '../../lib/services/forum.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const actor = await actorFrom(context);
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');
    if (id) {
      const r = await getThread(actor, id);
      return ok(r.data);
    }
    const r = await listThreads(actor, {
      boardId: url.searchParams.get('boardId') || 0,
      keyword: url.searchParams.get('keyword') || '',
      page: url.searchParams.get('page') || 1,
      scope: url.searchParams.get('scope') || '',
    });
    return ok(r.data);
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context);
    const body = await readBody(context.request, 128 * 1024);
    const r = await handleThreadAction(actor, body);
    return ok(r.data, r.message);
  } catch (e) {
    return jsonError(e);
  }
}
