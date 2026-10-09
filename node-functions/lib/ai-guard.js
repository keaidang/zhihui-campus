// node-functions/lib/ai-guard.js — AI 调用频控（DB 流水计数）
//
// 为什么不用内存计数：EdgeOne Node Functions 多实例内存不共享，内存限流实测无效（铁律 #23）。
// 因此一律按 ai_usage_log 的**数据库流水**计数，与登录限流同范式。
// 计数口径：滚动窗口（近 1 分钟 / 近 24 小时），一律用 SQL 侧 NOW() 比较（库内是 UTC 墙钟）。
import { query } from './db.js';
import { getBool, getInt } from './ai-config.js';

/** AI 总开关：关闭时所有 AI 能力静默降级（调用方返回降级文案） */
export async function aiEnabled() {
  return getBool('ai.enabled', true);
}

/**
 * 消耗一次配额。超限返回 { ok:false }，调用方回 49429。
 * @param {number} userId
 * @param {string} kind chat/action/insight/review/study/...
 * @param {{perMin?:number, perDay?:number}} limits 缺省用 sys_config 中的值
 */
export async function consumeAiQuota(userId, kind, limits = {}) {
  const perMin = Number.isFinite(limits.perMin) ? limits.perMin : await getInt('ai.chat.rate_per_min', 10);
  const perDay = Number.isFinite(limits.perDay) ? limits.perDay : await getInt('ai.chat.daily_per_user', 200);

  const [minRow] = await query(
    'SELECT COUNT(*) AS n FROM ai_usage_log WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 MINUTE',
    [Number(userId)],
  );
  if (perMin > 0 && Number(minRow?.n || 0) >= perMin) {
    return { ok: false, scope: 'min', limit: perMin, message: `操作太快了，每分钟最多 ${perMin} 次，请稍后再试` };
  }

  const [dayRow] = await query(
    'SELECT COUNT(*) AS n FROM ai_usage_log WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 DAY',
    [Number(userId)],
  );
  if (perDay > 0 && Number(dayRow?.n || 0) >= perDay) {
    return { ok: false, scope: 'day', limit: perDay, message: `今日 AI 使用次数已达上限（${perDay} 次），请明天再试` };
  }

  return { ok: true, kind: String(kind || 'other') };
}

/** 近 N 天用量汇总（管理端/论文统计用） */
export async function usageSummary(days = 7) {
  const rows = await query(
    `SELECT kind,
            COUNT(*) AS calls,
            SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS okCalls,
            COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
            COALESCE(SUM(completion_tokens), 0) AS completionTokens,
            COALESCE(ROUND(AVG(cost_ms)), 0) AS avgMs
       FROM ai_usage_log
      WHERE created_at > NOW() - INTERVAL ? DAY
      GROUP BY kind ORDER BY calls DESC`,
    [Number(days) || 7],
  );
  return rows.map((r) => ({
    kind: r.kind,
    calls: Number(r.calls),
    okCalls: Number(r.okCalls),
    promptTokens: Number(r.promptTokens),
    completionTokens: Number(r.completionTokens),
    avgMs: Number(r.avgMs),
  }));
}
