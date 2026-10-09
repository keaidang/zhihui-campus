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
import { consumeAiQuota, releaseAiQuota } from '../../lib/ai-guard.js';
import { canInsight, pickTemplate, runInsight } from '../../lib/ai-insight.js';
import { runStructuredQuery } from '../../lib/ai-query.js';

export { preflight as onRequestOptions };

export async function onRequestPost(context) {
  // ★ held：记录"是否已占用一次在途额度"，供 finally 释放。
  //   写成外层变量而不是内层 try/finally，是为了**避免给整个函数体重新缩进** ——
  //   那种大范围改动最容易碰到无关代码（此处的处理逻辑分支多、return 点多）。
  let held = 0;
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
    held = actor.userId;

    const parsed = await pickTemplate(actor, text);
    if (!parsed) return fail(49430, '问数服务暂时不可用，请稍后再试', 503);

    // ---- C13 通用结构化查询：模板覆盖不到时由它接手 ----
    // 放在模板之后：模板的多表统计表达力更强且已验证，能用模板就优先。
    if (!parsed.template && parsed.query) {
      try {
        const r = await runStructuredQuery(actor, parsed.query);
        return ok({
          intent: { template: null, entity: r.entity, label: `${r.entityLabel}统计` },
          kind: 'data',
          viaQuery: true,
          isAggregate: r.isAggregate,
          scalar: r.scalar,
          rows: r.rows,
          summary: r.summary,
          metrics: r.metrics,
          groupBy: r.groupBy,
          sources: parsed.sources,
          degraded: false,
        });
      } catch (e) {
        // ★ 与模板分支同口径：49402（查询不合法）降级为「给个说法并指路」，
        //   其它（越权 49403 等）如实抛 —— 掩盖权限问题比报错危险。
        if (e?.code !== 49402) throw e;
        return ok({
          intent: { template: null },
          kind: 'none',
          reply: `没能把这个问题转成查询（${e.message}）。可以换个说法，例如"学生账号总数""各院系人数排名""绩点最差的学生"。`,
          sources: parsed.sources,
        });
      }
    }

    if (!parsed.template) {
      return ok({
        intent: { template: null },
        kind: 'none',
        reply:
          parsed.reply ||
          '我不确定你想看哪项数据。可以试试"近 7 天哪个班请假最多""各院系请假天数排名""学生账号总数""绩点最差的学生"。',
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
  } finally {
    // ★ 无论成功/失败/提前 return 都要释放在途标记，否则会白占额度（TTL 虽兜底，但会白占 2 分钟）
    if (held) releaseAiQuota(held);
  }
}
