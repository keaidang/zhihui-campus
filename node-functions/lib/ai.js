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

/** 失败落库（尽力而为，动态 import 避免模块级循环依赖；与 lib/http.js 的 500 落库同思路） */
function logAiError(kind, detail) {
  console.error('[ai-error]', kind, detail);
  import('./db.js')
    .then(({ getPool }) =>
      getPool()
        .query('INSERT INTO sys_op_log (operator_id, action, target, detail) VALUES (0, ?, ?, ?)', [
          'ai.error',
          String(kind).slice(0, 128),
          String(detail || '').slice(0, 500),
        ])
        .catch(() => {}),
    )
    .catch(() => {});
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
      logAiError('upstream.http', `${res.status} ${txt.slice(0, 300)}`);
      return null;
    }
    return { response: res, costMs: Date.now() - t0 };
  } catch (e) {
    logAiError(e?.name === 'TimeoutError' ? 'upstream.timeout' : 'upstream.network', String(e?.message || e));
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
      logAiError('chat.http', `${res.status} ${txt.slice(0, 300)}`);
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
    logAiError(e?.name === 'TimeoutError' ? 'chat.timeout' : 'chat.network', String(e?.message || e));
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
 * @returns {Promise<object|null>}
 */
export async function aiJson({ system, user, maxTokens = 512, temperature = 0.1, timeoutMs, thinking = false } = {}) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: String(user ?? '') });

  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await aiChat({ messages, json: true, maxTokens, temperature, timeoutMs, thinking });
    if (!r) return null;
    try {
      const obj = JSON.parse(stripFence(r.content));
      if (obj && typeof obj === 'object') return { ...obj, _usage: r.usage, _costMs: r.costMs };
    } catch {
      /* 落到重试 */
    }
    if (attempt === 0) logAiError('json.retry', String(r.content || '').slice(0, 200));
  }
  logAiError('json.parse', '重试后仍无法解析为 JSON');
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
