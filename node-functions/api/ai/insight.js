// POST /api/ai/insight — C6 信息问数（校领导 / 管理员，全校只读）
//
// 协议：`{ text: "这周哪个班请假最多" }` →
//   { intent:{template,label}, params, periodLabel, rows, extra, summary }
//   或 { intent:{template:null}, reply, sources }（不是问数需求时用同一份知识库作答）
//
// ★ 安全：模型**只选模板 + 抽参数**，参数还要过 enum 白名单，SQL 全程由服务端参数化拼装。
//   （见 lib/ai-insight.js 顶部注释）
import { fail, jsonError, ok, preflight, readBody } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { aiConfigured, aiJson, aiModel, logAiUsage } from '../../lib/ai.js';
import { getBool } from '../../lib/ai-config.js';
import { consumeAiQuota } from '../../lib/ai-guard.js';
import { identityBlock, loadIdentity } from '../../lib/ai-identity.js';
import { KB_PROFILE, buildKnowledgeContext } from '../../lib/ai-kb.js';
import { buildAnswerSystem } from '../../lib/ai-prompt.js';
import { canInsight, insightPromptFor, runInsight } from '../../lib/ai-insight.js';

export { preflight as onRequestOptions };

const PARSE_RULES = [
  '你是「智汇校园」平台的**数据问数解析器**。任务：把用户的问题映射到下方【可用问数模板】。',
  '',
  '【输出格式】严格输出 JSON，不要任何解释文字：',
  '{"template":"<模板 key 或 null>","params":{...},"reply":"<仅当 template=null 时填写>"}',
  '',
  '【硬性规则】',
  '1. template 必须是下方列出的 key 之一；**不确定就填 null**，绝不编造。',
  '2. params 里的枚举值**只能取括号中列出的值**，不要自造（例如时间范围只能填 7d / 30d / 180d / all）。',
  '3. 用户只是在问制度、流程、校园情况（不是要统计数据）时，template 填 null，reply 里按下方【资料】回答。',
  '4. 不要输出 SQL，也不要描述你打算怎么查——只选模板。',
].join('\n');

const FINAL_JUDGE = [
  '【最终判定】先判断用户是不是在**要统计数据**：',
  '- 是 → 输出 template + params，reply 留空。',
  '- 不是 → template 填 null，reply 里正常回答用户的问题（当作校园助手）。',
].join('\n');

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

    const identity = await loadIdentity(actor.userId);
    const kb = await buildKnowledgeContext(text, { inlineMaxChars: 4000, topK: 5, minScore: 3, minRatio: 0.25 });
    const system = buildAnswerSystem({
      identityText: identityBlock(identity, actor.roles),
      kbProfile: KB_PROFILE,
      kbText: kb.text,
      extraTop: [PARSE_RULES, '', '【可用问数模板】', insightPromptFor(actor), '', FINAL_JUDGE].join('\n'),
    });

    const t0 = Date.now();
    const parsed = await aiJson({ system, user: text, maxTokens: 400, temperature: 0, timeoutMs: 8000, totalBudgetMs: 9000 });
    if (!parsed) {
      await logAiUsage({ userId: actor.userId, kind: 'insight', model: aiModel(), ok: 0, costMs: Date.now() - t0 });
      return fail(49430, '问数服务暂时不可用，请稍后再试', 503);
    }
    await logAiUsage({
      userId: actor.userId,
      kind: 'insight',
      model: aiModel(),
      promptTokens: parsed._usage?.prompt_tokens ?? 0,
      completionTokens: parsed._usage?.completion_tokens ?? 0,
      ok: 1,
      costMs: Date.now() - t0,
    });

    const key = parsed.template == null ? null : String(parsed.template);
    if (!key) {
      return ok({
        intent: { template: null },
        kind: 'none',
        reply: String(parsed.reply || '我不确定你想看哪项数据。可以试试"近 7 天哪个班请假最多""各院系请假天数排名""选课人数最多的课"。').slice(0, 800),
        sources: kb.sources || [],
      });
    }

    const params = parsed.params && typeof parsed.params === 'object' ? parsed.params : {};
    const r = await runInsight(actor, key, params);
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
