// /api/forum/threads — 论坛帖子（HTTP 薄壳；仅登录用户可访问，合规要求）
// GET  ?boardId=&keyword=&page=        帖子列表（置顶优先）
// GET  ?id=123                          帖子详情 + 回复列表
// POST { action: 'create' | 'reply' | 'edit' | 'delete' | 'pin' | 'lock' }
//
// ★ P4 服务层重构（2026-10-09）：业务逻辑在 lib/services/forum.js。
// ★ P5 C2 论坛 AI 审核（2026-10-09）：发帖/回复挂 onBeforeInsert 钩子，判定结果落 ai_review_log。
//   审核**未开启时 hooks 为空对象**，行为与改造前完全一致（零额外开销）。
import { ok, jsonError, preflight, readBody } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { getThread, handleThreadAction, listThreads } from '../../lib/services/forum.js';
import { alertViolation, buildReviewHooks, recordReview } from '../../lib/ai-review.js';

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
    const action = String(body.action || '');
    const biz = action === 'reply' ? 'reply' : 'thread';

    // 只有发帖/回复需要审核；编辑/删除/置顶等不重复判（编辑已有内容由管理员复核处理）
    const reviewing = action === 'create' || action === 'reply';
    const { hooks, store } = reviewing
      ? await buildReviewHooks({ kind: biz, title: body.title || '', content: body.content || '' })
      : { hooks: {}, store: { result: null, blocked: false } };

    try {
      const r = await handleThreadAction(actor, body, hooks);
      await recordReview({ store, biz, bizId: r.data?.id, authorId: actor.userId });
      // 判定违规但管理员选择了"不拦截" → 内容已入库，仍要告警（C2 → C3 联动）
      await alertViolation({ actor, store, biz, bizId: r.data?.id });
      return ok(r.data, r.message);
    } catch (e) {
      // 被拦截时帖子**没有 id**，biz_id 记 0 也留痕，便于统计"拦截了多少条"
      await recordReview({ store, biz, bizId: null, authorId: actor.userId });
      await alertViolation({ actor, store, biz, bizId: null, blocked: true });
      throw e;
    }
  } catch (e) {
    return jsonError(e);
  }
}
