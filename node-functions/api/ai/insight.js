// POST /api/ai/insight — C6 信息问数（校领导 / 管理员，全校只读）
//
// 协议：`{ text: "这周哪个班请假最多" }` →
//   { intent:{template,label}, params, periodLabel, rows, extra, summary }
//   或 { intent:{template:null}, reply, sources }（不是问数需求时用同一份知识库作答）
//
// ★ 安全：模型**只选模板 + 抽参数**，参数还要过 enum 白名单，SQL 全程由服务端参数化拼装。
//   （见 lib/ai-insight.js 顶部注释）
//
// ★ "问法 → 模板"的解析已抽到 lib/ai-insight.js 的 `pickTemplate()`：
//   因为 AI 效果评估（api/ai/eval.js）要跑**同一条真实链路**。若评估脚本自己复制
//   一份提示词，量出来的就不是线上行为，指标没有意义。
import { fail, jsonError, ok, preflight, readBody } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { aiConfigured } from '../../lib/ai.js';
import { getBool } from '../../lib/ai-config.js';
import { consumeAiQuota } from '../../lib/ai-guard.js';
import { canInsight, pickTemplate, runInsight } from '../../lib/ai-insight.js';

export { preflight as onRequestOptions };

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context);
    const body = await readBody(context.request, 8 * 1024);
    const text = String(body.text || '').trim();
    if (!text) return fail(49401, '请输入你要查询的内容');
    if (text.length > 300) return fail(49401, '问题太长了，请控制在 300 字以内');

    if (!canInsight(actor)) return fail(49403, '你的角色没有信息问数权限', 403);
    if (!aiConfigured()) return fail(49400, 'AI 问数暂未开通，请联系管理员', 503);
    if (!(await getBool('ai.enabled', true))) return fail(49430, 'AI 功能已被管理员暂时关闭', 503);
    if (!(await getBool('ai.insight.enabled', true))) return fail(49430, '信息问数已被管理员关闭', 503);

    const quota = await consumeAiQuota(actor.userId, 'insight');
    if (!quota.ok) return fail(49429, quota.message, 429);

    const parsed = await pickTemplate(actor, text);
    if (!parsed) return fail(49430, '问数服务暂时不可用，请稍后再试', 503);

    if (!parsed.template) {
      return ok({
        intent: { template: null },
        kind: 'none',
        reply:
          parsed.reply ||
          '我不确定你想看哪项数据。可以试试"近 7 天哪个班请假最多""各院系请假天数排名""选课人数最多的课"。',
        sources: parsed.sources,
      });
    }

    const r = await runInsight(actor, parsed.template, parsed.params);
    return ok({
      intent: { template: r.template, label: r.label },
      kind: 'data',
      params: r.params,
      periodLabel: r.periodLabel,
      rows: r.rows,
      extra: r.extra,
      summary: r.summary,
      degraded: false,
    });
  } catch (e) {
    return jsonError(e);
  }
}
