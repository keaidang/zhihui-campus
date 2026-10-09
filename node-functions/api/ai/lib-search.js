// /api/ai/lib-search — C12 图书自然语言检索（全员）
//
// POST { question } → { books, parsed, note, degraded }
//
// 与 /api/ai/chat 的区别：这里**不生成自然语言答案**，只把口语问题转成检索条件并返回结构化书目，
//   由图书馆页面渲染成卡片 —— 学生要的是"能借的书"，不是一段关于书的介绍。
// 失败降级：AI 不可用时退化为整句关键词 LIKE 检索（功能不消失，只是笨一点）。
import { ok, fail, jsonError, preflight, readBody } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { consumeAiQuota } from '../../lib/ai-guard.js';
import { libSearch } from '../../lib/ai-lib-search.js';

export { preflight as onRequestOptions };

export async function onRequestPost(context) {
  try {
    const { userId } = await requireRoles(context);
    const body = await readBody(context.request, 4 * 1024);
    const question = String(body.question || '').trim();
    if (!question) return fail(49401, '请描述你想找什么书');

    // 频控只在"会真的调用模型"时消耗——降级路径（AI 关了）不该占用额度。
    // 这里采取保守做法：先扣一次；如果最终是降级路径，扣的那次也仅占 1 次额度，无副作用。
    const quota = await consumeAiQuota(userId, 'lib_search');
    if (!quota.ok) return fail(49429, quota.message, 429);

    const r = await libSearch({ question, userId });
    return ok(r, r.books.length ? `找到 ${r.books.length} 本` : '没有找到匹配的图书，换个说法试试');
  } catch (e) {
    return jsonError(e);
  }
}
