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

// ---------------------------------------------------------------------------
// 在途标记（check-then-act 窗口的补丁）
// ---------------------------------------------------------------------------
//
// ★ 为什么在"DB 流水计数"之外还要这个补充
//   铁律 #23 说的是「内存计数不能当限流用」（多实例内存不共享）。这里**不是**限流本身，
//   而是给限流的 check-then-act 窗口打补丁：
//   计数读的是 ai_usage_log，而那一行是在 AI 调用**结束之后**才写入的。
//   于是「读计数 → 调 AI → 写流水」之间存在一个**与调用时长等长**的窗口，
//   同一秒内并发的 N 个请求会全部读到旧计数而同时放行（典型 TOCTOU）。
//   把「已放行但尚未结束」的次数一并计入，窗口就从"整个调用时长"压缩到"实例内几乎瞬时"。
//
// ★ 自愈设计（关键）：标记带 TTL，到期自动失效。
//   内存计数器最危险的失败模式是"某条路径忘了释放 → 用户被永久锁死"。
//   有了 TTL，即使漏了 release，最坏只是多限制一会儿，**永远不会永久锁死**。
//
// ★ 局限（诚实说明，不要当成已彻底解决）：
//   EdgeOne 是多实例的，本 Map 只覆盖当前实例；跨实例并发仍可能略微超出限额。
//   "每分钟 N 次"是**成本控制**而非安全边界，这个残留窗口可以接受。
const INFLIGHT_TTL_MS = 120_000; // 覆盖最长的流式调用时长
const inflight = new Map(); // userId(number) -> 放行时间戳数组

/** 清掉过期标记并返回仍有效的那些 */
function aliveInflight(userId) {
  const arr = inflight.get(userId);
  if (!arr) return [];
  const now = Date.now();
  const alive = arr.filter((t) => now - t < INFLIGHT_TTL_MS);
  if (alive.length) inflight.set(userId, alive);
  else inflight.delete(userId);
  return alive;
}

/** 放行时登记一次在途（由 consumeAiQuota 内部调用） */
function markInflight(userId) {
  const alive = aliveInflight(userId);
  alive.push(Date.now());
  inflight.set(userId, alive);
}

/**
 * 释放一次在途标记 —— 调用方在 AI 调用结束后调用（handler 的 finally 里）。
 *
 * 刻意做成「幂等 + 绝不抛异常」：它只是让计数更准，
 * 任何情况下都不该影响业务（大不了多限制一会儿，TTL 会兜住）。
 */
export function releaseAiQuota(userId) {
  try {
    const uid = Number(userId);
    const alive = aliveInflight(uid);
    alive.shift(); // 移除最早的一次，不关心具体是哪次
    if (alive.length) inflight.set(uid, alive);
    else inflight.delete(uid);
  } catch {
    /* 静默：释放失败不影响业务 */
  }
}

/** 仅供单测断言在途数量（生产代码不要使用） */
export function _inflightCount(userId) {
  return aliveInflight(Number(userId)).length;
}

/**
 * 消耗一次配额。超限返回 { ok:false }，调用方回 49429。
 *
 * ★ 计数 = DB 流水条数 + **本实例在途条数**。
 *   只算 DB 会漏掉"已放行但流水还没落库"的那些并发请求（见文件上方"在途标记"说明）。
 *   放行时会登记一次在途，调用方结束后应调用 releaseAiQuota() 释放；
 *   即便忘了释放，标记也会在 INFLIGHT_TTL_MS 后自动失效。
 *
 * @param {number} userId
 * @param {string} kind chat/action/insight/review/study/...
 * @param {{perMin?:number, perDay?:number}} limits 缺省用 sys_config 中的值
 */
export async function consumeAiQuota(userId, kind, limits = {}) {
  const uid = Number(userId);
  const perMin = Number.isFinite(limits.perMin) ? limits.perMin : await getInt('ai.chat.rate_per_min', 10);
  const perDay = Number.isFinite(limits.perDay) ? limits.perDay : await getInt('ai.chat.daily_per_user', 200);
  const inflightN = aliveInflight(uid).length;

  const [minRow] = await query(
    'SELECT COUNT(*) AS n FROM ai_usage_log WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 MINUTE',
    [uid],
  );
  if (perMin > 0 && Number(minRow?.n || 0) + inflightN >= perMin) {
    return { ok: false, scope: 'min', limit: perMin, message: `操作太快了，每分钟最多 ${perMin} 次，请稍后再试` };
  }

  const [dayRow] = await query(
    'SELECT COUNT(*) AS n FROM ai_usage_log WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 DAY',
    [uid],
  );
  if (perDay > 0 && Number(dayRow?.n || 0) + inflightN >= perDay) {
    return { ok: false, scope: 'day', limit: perDay, message: `今日 AI 使用次数已达上限（${perDay} 次），请明天再试` };
  }

  // 通过 → 登记在途，让同时到达的其它请求能看到"有人正在用"
  markInflight(uid);
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
