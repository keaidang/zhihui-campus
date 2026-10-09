// node-functions/lib/ai.js — AI 统一调用出口（全项目唯一调用点）
//
// 设计（照 lib/notify.js 的"唯一出口 + 尽力而为"模式，见 ADR-9）：
//   · 密钥只从环境变量读，绝不入参、绝不入库
//   · **默认关闭思考模式**（enable_thinking:false）—— 实测意图 JSON 快 6.2 倍、
//     输出 token 降 94%，且只有关思考时 tool_choice:required 才可用（ADR-9 硬约束二）
//   · **只用文本**：本模块不接受、不转发任何图片/音频/视频内容（铁律 #36）
//   · 一切失败（未配置 / 超时 / 非 2xx / 解析失败）统一返回 null，**绝不抛异常**，
//     由调用方降级 —— "AI 挂了业务照常"
//   · 失败落 sys_op_log(action='ai.error')，线上无控制台时可远程诊断（铁律 #3）
import { query } from './db.js';

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL = 'qwen3.8-omni-flash';
const TIMEOUT_MS = 12_000; // 非流式默认超时
const STREAM_TIMEOUT_MS = 45_000; // 流式放宽（但受 Node Functions 120s 墙钟约束）

export const aiBaseUrl = () => String(process.env.AI_QWEN_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
export const aiModel = () => String(process.env.AI_QWEN_MODEL || DEFAULT_MODEL);
export const aiProvider = () => String(process.env.AI_PROVIDER || 'qwen');
export const aiConfigured = () => Boolean(process.env.AI_QWEN_API_KEY);

/** 供 /api/ai/status 返回（不含任何密钥片段） */
export function aiMeta() {
  return { provider: aiProvider(), model: aiModel(), configured: aiConfigured() };
}

/**
 * 失败落库（与 lib/http.js 的 500 落库同思路）——**必须 await**：
 *   · Serverless/边缘运行时**不保证**响应之后的后台 Promise 还会执行完，fire-and-forget 会丢
 *   · 这里同时承担「AI 连续失败 → 告警管理员」的计数依据，丢一条就可能永远凑不满阈值
 * 落库失败或告警失败都不影响降级（本函数自身不抛）。
 */
async function logAiError(kind, detail) {
  console.error('[ai-error]', kind, detail);
  try {
    await query('INSERT INTO sys_op_log (operator_id, action, target, detail) VALUES (0, ?, ?, ?)', [
      'ai.error',
      String(kind).slice(0, 128),
      String(detail || '').slice(0, 500),
    ]);
  } catch {
    /* 落库失败不影响降级 */
  }
  await alertAiFailure(kind, detail);
}

/** AI 连续失败告警（C3）：10 分钟内 ai.error ≥ 5 次 → 每自然小时最多一封 */
async function alertAiFailure(kind, detail) {
  try {
    const [r] = await query(
      "SELECT COUNT(*) AS n FROM sys_op_log WHERE action = 'ai.error' AND created_at > NOW() - INTERVAL 10 MINUTE",
    );
    const n = Number(r?.n || 0);
    if (n < 5) return;
    const hour = new Date().toISOString().slice(0, 13);
    // 动态 import：让 alert/邮件链路不进入每次 AI 调用的静态依赖图（缩冷启动）
    const { alert } = await import('./alert.js');
    await alert.aiFailure({
      title: `AI 服务近期连续失败 ${n} 次（10 分钟内）`,
      detail: [
        `失败类型：${kind}`,
        `失败次数（10 分钟）：${n}`,
        `最近一次详情：${String(detail || '').slice(0, 300)}`,
        '',
        '可能原因：上游额度/限流、网关抖动、密钥失效、知识库或库连接异常。',
        '建议动作：查看 sys_op_log 中 action=ai.error 的记录；必要时在【AI 管理控制台】临时关闭 AI 功能，',
        '业务本身不受影响（所有 AI 能力均为降级设计，失败返回友好文案）。',
      ].join('\n'),
      dedupeKey: `ai_fail:${hour}`,
    });
  } catch {
    /* 告警失败不影响 AI 降级 */
  }
}

/**
 * 组装上游请求（不发送）
 * @param {object} o
 * @param {Array<{role:string,content:string}>} o.messages
 * @param {boolean} [o.json]      是否要求 JSON 输出
 * @param {boolean} [o.thinking]  ★ 默认 false
 * @param {boolean} [o.stream]
 */
function buildInit({ messages, json = false, thinking = false, stream = false, maxTokens = 512, temperature = 0.1 }) {
  const body = {
    model: aiModel(),
    messages,
    max_tokens: Math.max(16, Math.min(8192, Number(maxTokens) || 512)),
    temperature: Number.isFinite(temperature) ? temperature : 0.1,
    enable_thinking: Boolean(thinking), // ★ 硬约束二：默认关
  };
  if (json && !stream) body.response_format = { type: 'json_object' };
  if (stream) body.stream = true;
  return {
    url: `${aiBaseUrl()}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AI_QWEN_API_KEY || ''}` },
      body: JSON.stringify(body),
    },
  };
}

/**
 * 直接拿到上游响应（流式场景用；调用方负责 pipeUpstreamWithTap 透传与计数）
 * @returns {Promise<{response: Response, costMs: number}|null>}
 */
export async function aiUpstream(opts = {}) {
  if (!aiConfigured()) return null;
  const { url, init } = buildInit({ ...opts, stream: true });
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs || STREAM_TIMEOUT_MS) });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      await logAiError('upstream.http', `${res.status} ${txt.slice(0, 300)}`);
      return null;
    }
    return { response: res, costMs: Date.now() - t0 };
  } catch (e) {
    await logAiError(e?.name === 'TimeoutError' ? 'upstream.timeout' : 'upstream.network', String(e?.message || e));
    return null;
  }
}

/**
 * 非流式对话
 * @returns {Promise<{content:string, reasoning:string, usage:object|null, costMs:number}|null>}
 */
export async function aiChat(opts = {}) {
  if (!aiConfigured()) return null;
  const { url, init } = buildInit(opts);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs || TIMEOUT_MS) });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      await logAiError('chat.http', `${res.status} ${txt.slice(0, 300)}`);
      return null;
    }
    const j = await res.json();
    const msg = j?.choices?.[0]?.message || {};
    return {
      content: String(msg.content ?? ''),
      reasoning: String(msg.reasoning_content ?? ''),
      usage: j?.usage || null,
      costMs: Date.now() - t0,
    };
  } catch (e) {
    await logAiError(e?.name === 'TimeoutError' ? 'chat.timeout' : 'chat.network', String(e?.message || e));
    return null;
  }
}

/** 去掉模型偶尔套上的 ```json 围栏 / 前后杂字 */
function stripFence(s) {
  const t = String(s || '').trim();
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const body = m ? m[1] : t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

/**
 * 强制 JSON 输出：解析失败重试 1 次后放弃（ADR-9：不做无限重试）
 *
 * ★ totalBudgetMs（总预算）为什么必须有（2026-10-09 线上实测的教训）：
 *   本函数最多尝试 2 次，若每次都跑满 timeoutMs，总耗时可达 2×timeoutMs（例如 24s）。
 *   一旦顶到**平台函数超时**，EdgeOne 会重试这次调用，而 HTTP 请求体**已经被消费过**，
 *   重试必然抛 `Body is unusable: Body has already been read` → 用户看到 500。
 *   给出总预算后，剩余时间不足就**不再重试**，宁可返回 null 走降级（调用方会回友好文案），
 *   也不要把请求推到平台墙上。
 *
 * @param {object} [o]
 * @param {number} [o.totalBudgetMs] 整个函数（含重试）的墙钟上限
 * @returns {Promise<object|null>}
 */
export async function aiJson({ system, user, maxTokens = 512, temperature = 0.1, timeoutMs, thinking = false, totalBudgetMs } = {}) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: String(user ?? '') });

  const t0 = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    // 剩余预算不足（默认要求至少留 1.2s 给这一次尝试）→ 放弃重试，直接降级
    let perAttempt = timeoutMs;
    if (totalBudgetMs) {
      const left = totalBudgetMs - (Date.now() - t0);
      if (left < 1200) {
        await logAiError('json.budget', `重试前剩余预算不足（已用 ${Date.now() - t0}ms / 预算 ${totalBudgetMs}ms）`);
        return null;
      }
      perAttempt = Math.min(timeoutMs ?? TIMEOUT_MS, left);
    }
    const r = await aiChat({ messages, json: true, maxTokens, temperature, timeoutMs: perAttempt, thinking });
    if (!r) return null;
    try {
      const obj = JSON.parse(stripFence(r.content));
      if (obj && typeof obj === 'object') return { ...obj, _usage: r.usage, _costMs: r.costMs };
    } catch {
      /* 落到重试 */
    }
    if (attempt === 0) await logAiError('json.retry', String(r.content || '').slice(0, 200));
  }
  await logAiError('json.parse', '重试后仍无法解析为 JSON');
  return null;
}

/** 记录一次 AI 调用流水（频控计数 + 论文统计） */
export async function logAiUsage({ userId, kind = 'other', model, promptTokens = 0, completionTokens = 0, ok = 1, costMs = 0 }) {
  try {
    await query(
      `INSERT INTO ai_usage_log (user_id, kind, model, prompt_tokens, completion_tokens, ok, cost_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [Number(userId) || 0, String(kind).slice(0, 16), String(model || aiModel()).slice(0, 48), Number(promptTokens) || 0, Number(completionTokens) || 0, ok ? 1 : 0, Number(costMs) || 0],
    );
  } catch (e) {
    console.error('[ai-usage-log-fail]', e?.message);
  }
}
