// /api/ai/review — C2 审核队列与人工复核（仅超管）
// GET  ?handled=0|1|2|all&page=&pageSize=   待复核队列 / 审核日志
// POST { id, action: 'confirm_violation' | 'false_positive', penalty?: boolean }
//
// 处置结果：确认违规 → 内容软删 + review_status=2（可选禁言）；误判 → review_status=0 放行。
// 全部落 sys_op_log，便于统计"AI 判了多少、人工纠正了多少"（论文可用）。
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { handleReview, listReviewQueue } from '../../lib/ai-review.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    await actorFrom(context, ['admin']);
    const url = new URL(context.request.url);
    const data = await listReviewQueue({
      handled: url.searchParams.get('handled') ?? '0',
      page: url.searchParams.get('page') || 1,
      pageSize: url.searchParams.get('pageSize') || 20,
    });
    return ok(data);
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context, ['admin']);
    const body = await readBody(context.request);
    const action = String(body.action || '');
    if (action !== 'confirm_violation' && action !== 'false_positive') {
      // 49431 的语义是「记录不存在」，用它表达「不支持的操作」会让排查方向跑偏
      // （会去查记录，而问题其实在入参）。这里改用 49401（入参错误）——与 docs/API.md 一致。
      return fail(49401, `不支持的操作「${action}」，可选：confirm_violation / false_positive`);
    }
    const r = await handleReview(actor, { id: body.id, action, penalty: Boolean(body.penalty) });
    return ok(r.data, r.message);
  } catch (e) {
    return jsonError(e);
  }
}
