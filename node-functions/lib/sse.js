// node-functions/lib/sse.js — SSE 流式响应封装（含平台能力探测与自动降级）
//
// 背景：EdgeOne Node Functions 能否把 ReadableStream **增量**推给客户端未经验证（P0 待实测）。
// 因此本模块的设计原则是"服务端尽力流式 + 客户端自适应"：
//   · 服务端：能增量就增量（SSE）；平台若把 body 缓冲成整段，客户端拿到的仍是完整正确内容
//   · 客户端：若发现数据一次性到达（无分片间隔），自动切换为"打字机模拟"
// 这样无论平台行为如何，**数据正确性与用户体验都不受影响**，不需要在部署前赌平台能力。
//
// 与 http.js 的关系：复用 SECURITY_HEADERS（铁律 #29：安全头不能因为换了响应类型就漏掉）。

import { SECURITY_HEADERS } from './http.js';

/** SSE 响应头：在安全头基础上替换 Content-Type 并禁止任何中间层缓冲 */
export const SSE_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Type': 'text/event-stream; charset=UTF-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no', // nginx/网关类中间层的反缓冲开关
};

/** 组装一条 SSE 消息：event 可选，data 支持对象（自动 JSON 化）与多行文本 */
export function sseEvent(event, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const lines = String(payload)
    .split('\n')
    .map((l) => `data: ${l}`)
    .join('\n');
  return `${event ? `event: ${event}\n` : ''}${lines}\n\n`;
}

/**
 * 异步生成器 → SSE Response
 * @param {AsyncGenerator<string>} gen 逐片产出**已格式化**的 SSE 文本（用 sseEvent 组装）
 */
export function sseResponse(gen) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of gen) controller.enqueue(encoder.encode(chunk));
      } catch (e) {
        // 流中途出错：以 error 事件收尾（HTTP 状态已发出，无法再改）
        controller.enqueue(encoder.encode(sseEvent('error', { message: String(e?.message || e) })));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

/**
 * 解析 OpenAI 兼容上游的一行 `data:` 内容
 * @returns {{ delta: string, reasoning: string, usage: object|null }}
 */
export function parseUpstreamDelta(dataStr) {
  let j;
  try {
    j = JSON.parse(dataStr);
  } catch {
    return { delta: '', reasoning: '', usage: null };
  }
  const choice = j?.choices?.[0] || {};
  const d = choice.delta || choice.message || {};
  return {
    delta: typeof d.content === 'string' ? d.content : '',
    reasoning: typeof d.reasoning_content === 'string' ? d.reasoning_content : '',
    usage: j?.usage || null,
  };
}

/**
 * 把上游 fetch 的 SSE 响应体**透传**给客户端，同时旁路累积全文与 usage 供落库。
 * 不改写内容（原样转发字节），只在旁路解析，因此即使解析失败也不影响客户端。
 *
 * @param {Response} upstream 已带 body 的上游响应（stream: true）
 * @param {(info:{content:string,usage:object|null,reasoning:string})=>Promise<void>} [onDone]
 *        流结束后回调（用于写 ai_usage_log）。**其异常会被吞掉**，不影响响应。
 * @returns {{ response: Response, done: Promise<object> }}
 */
export function pipeUpstreamWithTap(upstream, onDone) {
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let usage = null;
  let settled = false;

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const finish = async () => {
    if (settled) return;
    settled = true;
    const info = { content, usage, reasoning };
    try {
      if (onDone) await onDone(info);
    } catch (e) {
      console.error('[sse-tap-fail]', e?.message);
    }
    resolveDone(info);
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk); // ① 原样转发（字节级，不改写）
      try {
        // ② 旁路解析，仅用于统计
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const ln of lines) {
          const s = ln.trim();
          if (!s.startsWith('data:')) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const { delta, reasoning: r, usage: u } = parseUpstreamDelta(payload);
          if (delta) content += delta;
          if (r) reasoning += r;
          if (u) usage = u;
        }
      } catch {
        /* 旁路解析失败不影响转发 */
      }
    },
    flush() {
      return finish();
    },
  });

  const body = upstream.body ? upstream.body.pipeThrough(transform) : null;
  if (!body) {
    // 上游没有 body（异常情况）：直接收尾，避免 done 悬挂
    finish();
    return { response: new Response(null, { status: 200, headers: SSE_HEADERS }), done };
  }
  return { response: new Response(body, { status: 200, headers: SSE_HEADERS }), done };
}

/**
 * 把已生成的整段文本"重新分片"为 SSE（降级 / 非流式上游统一走这里）
 * 目的：客户端只有一种解析路径，不需要区分"真流式"与"整段回退"。
 */
export async function* textToSseStream(text, { chunkSize = 12 } = {}) {
  const s = String(text || '');
  for (let i = 0; i < s.length; i += chunkSize) {
    yield sseEvent('delta', { text: s.slice(i, i + chunkSize) });
  }
  yield sseEvent('done', {});
}

/** 探测端点用：分片发送、每片间隔一段真实延迟，用于判定平台是否真增量推送 */
export async function* probeChunks({ chunks = 4, gapMs = 400 } = {}) {
  const t0 = Date.now();
  for (let i = 1; i <= chunks; i++) {
    yield sseEvent('probe', { i, total: chunks, elapsedMs: Date.now() - t0 });
    if (i < chunks) await new Promise((r) => setTimeout(r, gapMs));
  }
  yield sseEvent('done', { elapsedMs: Date.now() - t0, chunks });
}

/**
 * 上游 OpenAI 兼容 SSE → **本项目统一事件流**（`delta` / `done` / `error`）
 *
 * 与 `pipeUpstreamWithTap` 的分工：
 *   · pipeUpstreamWithTap：**字节级原样转发**，要求上下游协议一致（用于纯透传场景）
 *   · openAiToEvents    ：**重新组装**事件，前端只需实现一种解析路径（C1/C7 问答用这条）
 *
 * 事件序列：preamble 原样先发 → 若干 `delta{text}` → `done{usage,len}`；
 * 读取中途异常 → 补一个 `error` 事件后仍发 `done`，保证客户端循环一定能收尾。
 *
 * @param {Response} upstream 上游响应（stream:true）；body 为 null 时按空流处理
 * @param {object} [opts]
 * @param {string[]} [opts.preamble] 先于内容发出的**已格式化** SSE 文本（如 meta 事件）
 * @param {(info:{content:string,usage:object|null,reasoning:string})=>any} [opts.onDone]
 *        流结束回调（用于写 ai_usage_log）；其异常不影响已发出的响应
 * @param {(e:Error)=>void} [opts.onError]
 */
export async function* openAiToEvents(upstream, { preamble = [], onDone, onError } = {}) {
  for (const p of preamble) yield p;

  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let reasoning = '';
  let usage = null;

  try {
    const reader = upstream?.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const ln of lines) {
          const s = ln.trim();
          if (!s.startsWith('data:')) continue;
          const payload = s.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const { delta, reasoning: r, usage: u } = parseUpstreamDelta(payload);
          if (r) reasoning += r;
          if (u) usage = u;
          if (delta) {
            content += delta;
            yield sseEvent('delta', { text: delta });
          }
        }
      }
    }
  } catch (e) {
    try {
      onError?.(e);
    } catch {
      /* 回调异常不影响收尾 */
    }
    yield sseEvent('error', { message: 'AI 输出中断，可稍后重试' });
  }

  yield sseEvent('done', { usage, len: content.length });

  try {
    await onDone?.({ content, usage, reasoning });
  } catch (e) {
    console.error('[sse-ondone-fail]', e?.message);
  }
}
