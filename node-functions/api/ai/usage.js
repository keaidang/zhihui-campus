// /api/ai/usage — AI 用量与告警记录（仅超管，给 AI 管理控制台用）
//
// GET ?days=7
//   → { summary:[按 kind 汇总], totals:{calls,okRate,promptTokens,completionTokens},
//       recentCalls:[最近调用], alerts:[最近告警], reviewPending: 待复核条数 }
//
// 数据来源：ai_usage_log（频控 + 论文统计）、ai_alert_log（告警留痕）、ai_review_log。
// 论文里"AI 调用量 / token 消耗 / 平均耗时 / 成功率"直接取这里。
import { ok, jsonError, preflight } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { query } from '../../lib/db.js';
import { usageSummary } from '../../lib/ai-guard.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    await actorFrom(context, ['admin']);
    const url = new URL(context.request.url);
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 7)));

    const summary = await usageSummary(days);
    const calls = summary.reduce((n, r) => n + r.calls, 0);
    const okCalls = summary.reduce((n, r) => n + r.okCalls, 0);
    const promptTokens = summary.reduce((n, r) => n + r.promptTokens, 0);
    const completionTokens = summary.reduce((n, r) => n + r.completionTokens, 0);

    const recentCalls = await query(
      `SELECT l.id, l.user_id, l.kind, l.model, l.prompt_tokens, l.completion_tokens, l.ok, l.cost_ms, l.created_at,
              COALESCE(u.real_name, u.username, '-') AS user_name
         FROM ai_usage_log l LEFT JOIN sys_user u ON u.id = l.user_id
        ORDER BY l.id DESC LIMIT 30`,
    );

    const alerts = await query(
      `SELECT id, type, title, sent_to, ok, err, created_at FROM ai_alert_log ORDER BY id DESC LIMIT 20`,
    );

    // ⚠ 注意：query() 返回的是**行数组**。`const [rp] = await query(...)` 取的是"第一行"（对象），
    //   而 `const [rv] = await query(...)` 若当成数组用会得到 undefined 再 .map → 500。
    //   2026-10-09 线上验收正是踩到这个（/api/ai/usage 返回 50000）。
    const rpRows = await query("SELECT COUNT(*) AS n FROM ai_review_log WHERE handled = 0");
    const rv = await query(
      `SELECT verdict, COUNT(*) AS n FROM ai_review_log
        WHERE created_at > NOW() - INTERVAL ? DAY GROUP BY verdict`,
      [days],
    );

    return ok({
      days,
      summary,
      totals: {
        calls,
        okCalls,
        okRate: calls ? Math.round((okCalls / calls) * 1000) / 10 : null,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      recentCalls,
      alerts,
      review: {
        pending: Number(rpRows[0]?.n || 0),
        byVerdict: (rv || []).map((x) => ({ verdict: x.verdict, n: Number(x.n) })),
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
