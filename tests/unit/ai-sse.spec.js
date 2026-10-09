// SSE 流式封装单测（node-functions/lib/sse.js 的纯逻辑部分）
//
// 为什么值得测：流式链路一旦格式出错，前端会**静默地什么都不显示**（解析不到 delta），
// 比整段返回更难排查。所以协议格式与上游解析必须有断言。
// 不测 pipeUpstreamWithTap 的真实网络路径（那需要上游，已由 working/sse-test.mjs 端到端验证）。
import { describe, it, expect } from 'vitest';
import { sseEvent, parseUpstreamDelta, textToSseStream, SSE_HEADERS, openAiToEvents } from '../../node-functions/lib/sse.js';

describe('sseEvent · 协议格式', () => {
  it('对象统一 JSON 化', () => {
    expect(sseEvent('delta', { text: '你好' })).toBe('event: delta\ndata: {"text":"你好"}\n\n');
  });

  it('多行文本每行都加 data: 前缀（SSE 规范要求）', () => {
    expect(sseEvent('', 'a\nb')).toBe('data: a\ndata: b\n\n');
  });

  it('无 event 名时省略 event: 行', () => {
    expect(sseEvent(null, 'x')).toBe('data: x\n\n');
  });

  it('每条消息以空行结束（否则客户端不会派发）', () => {
    expect(sseEvent('x', 'y').endsWith('\n\n')).toBe(true);
  });
});

describe('parseUpstreamDelta · 上游增量解析', () => {
  it('取 content', () => {
    expect(parseUpstreamDelta('{"choices":[{"delta":{"content":"hi"}}]}').delta).toBe('hi');
  });

  it('取 reasoning_content（思考模式下为独立字段）', () => {
    const r = parseUpstreamDelta('{"choices":[{"delta":{"reasoning_content":"想想"}}]}');
    expect(r.reasoning).toBe('想想');
    expect(r.delta).toBe('');
  });

  it('取 usage（末片携带）', () => {
    const r = parseUpstreamDelta('{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}');
    expect(r.usage).toEqual({ prompt_tokens: 10, completion_tokens: 2 });
  });

  it('非法 JSON / 空对象不抛异常，返回空增量', () => {
    for (const bad of ['{bad', '', 'null', '[]', '{}']) {
      const r = parseUpstreamDelta(bad);
      expect(r.delta).toBe('');
      expect(r.usage).toBeNull();
    }
  });

  it('content 非字符串时不误用（null/数组都视为空）', () => {
    expect(parseUpstreamDelta('{"choices":[{"delta":{"content":null}}]}').delta).toBe('');
    expect(parseUpstreamDelta('{"choices":[{"delta":{"content":[1,2]}}]}').delta).toBe('');
  });
});

describe('textToSseStream · 整段文本降级为流', () => {
  it('分片拼回原文，且以 done 收尾', async () => {
    const chunks = [];
    for await (const c of textToSseStream('ABCDEFGHIJK', { chunkSize: 4 })) chunks.push(c);
    const text = chunks.join('');
    const deltas = [...text.matchAll(/event: delta\ndata: (.*)/g)].map((m) => JSON.parse(m[1]).text);
    expect(deltas.join('')).toBe('ABCDEFGHIJK');
    expect(text).toContain('event: done');
  });

  it('空文本只产出 done（不是零产出，否则客户端会一直等）', async () => {
    const chunks = [];
    for await (const c of textToSseStream('')) chunks.push(c);
    expect(chunks.join('')).toContain('event: done');
  });

  it('null 安全', async () => {
    const chunks = [];
    for await (const c of textToSseStream(null)) chunks.push(c);
    expect(chunks.join('')).toContain('event: done');
  });
});

describe('SSE_HEADERS · 安全头（铁律 #29）', () => {
  it('Content-Type 为 text/event-stream', () => {
    expect(SSE_HEADERS['Content-Type']).toContain('text/event-stream');
  });
  it('保留 API 安全头，不因换响应类型而漏掉', () => {
    expect(SSE_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SSE_HEADERS['X-Frame-Options']).toBe('DENY');
  });
  it('禁止缓存与中间层缓冲', () => {
    expect(SSE_HEADERS['Cache-Control']).toContain('no-cache');
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no');
  });
});

// ---------- openAiToEvents：上游 SSE → 本项目事件流 ----------
// 这段是"前端能不能看到字"的唯一通道：上游事件到达但转换出错，用户会看到
// 转圈到超时，而不是报错——属于最难排查的一类故障，所以必须有断言。

/** 用分片字符串伪造一个上游 Response（模拟网络切包，含跨片断行） */
function mockUpstream(pieces) {
  const enc = new TextEncoder();
  return {
    body: new ReadableStream({
      start(controller) {
        for (const p of pieces) controller.enqueue(enc.encode(p));
        controller.close();
      },
    }),
  };
}

/** 收集生成器的全部产出 */
async function collect(gen) {
  const out = [];
  for await (const c of gen) out.push(c);
  return out.join('');
}

/** 取出指定事件的所有 data（JSON 化） */
function events(text, name) {
  const re = new RegExp(`event: ${name}\\ndata: (.*)`, 'g');
  return [...text.matchAll(re)].map((m) => JSON.parse(m[1]));
}

describe('openAiToEvents · 上游事件重组', () => {
  it('delta 逐个透出，拼回原文', async () => {
    const up = mockUpstream([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const text = await collect(openAiToEvents(up));
    expect(events(text, 'delta').map((d) => d.text).join('')).toBe('你好');
  });

  it('跨分片被切断的 data 行仍能正确解析（网络不保证按事件分片）', async () => {
    const up = mockUpstream([
      'data: {"choices":[{"delta":{"cont',
      'ent":"半句"}}]}\n\ndata: {"choices":[{"delta":{"content":"后半"}}]}\n\n',
    ]);
    const text = await collect(openAiToEvents(up));
    expect(events(text, 'delta').map((d) => d.text).join('')).toBe('半句后半');
  });

  it('preamble 先于所有 delta 发出（meta 必须先到，前端才知道出处）', async () => {
    const up = mockUpstream(['data: {"choices":[{"delta":{"content":"答"}}]}\n\n']);
    const text = await collect(openAiToEvents(up, { preamble: [sseEvent('meta', { sources: [{ id: 1 }] })] }));
    expect(text.indexOf('event: meta')).toBeLessThan(text.indexOf('event: delta'));
    expect(events(text, 'meta')[0].sources).toEqual([{ id: 1 }]);
  });

  it('onDone 拿到累计全文与 usage（供落 ai_usage_log）', async () => {
    const up = mockUpstream([
      'data: {"choices":[{"delta":{"content":"甲"}}]}\n',
      'data: {"choices":[{"delta":{"content":"乙"}}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":9}}\n',
    ]);
    let got = null;
    await collect(openAiToEvents(up, { onDone: (i) => { got = i; } }));
    expect(got.content).toBe('甲乙');
    expect(got.usage.completion_tokens).toBe(9);
  });

  it('思考模式：reasoning_content 只统计不外发（不混进回答正文）', async () => {
    const up = mockUpstream([
      'data: {"choices":[{"delta":{"reasoning_content":"先想想…"}}]}\n',
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n',
    ]);
    let got = null;
    const text = await collect(openAiToEvents(up, { onDone: (i) => { got = i; } }));
    expect(events(text, 'delta').map((d) => d.text).join('')).toBe('答案');
    expect(got.reasoning).toBe('先想想…');
    expect(got.content).toBe('答案');
  });

  it('上游 body 为空 → 仍以 done 收尾（否则客户端永远等不到结束）', async () => {
    const text = await collect(openAiToEvents({ body: null }));
    expect(text).toContain('event: done');
    expect(events(text, 'delta')).toHaveLength(0);
  });

  it('读取中途抛错 → 补 error 事件后依然发 done', async () => {
    const boom = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"前"}}]}\n\n'));
        controller.error(new Error('socket closed'));
      },
    });
    let caught = null;
    const text = await collect(openAiToEvents({ body: boom }, { onError: (e) => { caught = e; } }));
    expect(caught?.message).toBe('socket closed');
    expect(text).toContain('event: error');
    expect(text.indexOf('event: done')).toBeGreaterThan(text.indexOf('event: error'));
  });

  it('onDone 抛异常不影响已产出的内容（落库失败不能反噬回答）', async () => {
    const up = mockUpstream(['data: {"choices":[{"delta":{"content":"稳"}}]}\n\n']);
    const text = await collect(openAiToEvents(up, { onDone: () => { throw new Error('db down'); } }));
    expect(events(text, 'delta').map((d) => d.text).join('')).toBe('稳');
    expect(text).toContain('event: done');
  });

  it('done 事件带 usage 与正文长度（前端可显示"已引用 N 字资料"）', async () => {
    const up = mockUpstream([
      'data: {"choices":[{"delta":{"content":"abc"}}]}\n',
      'data: {"choices":[],"usage":{"total_tokens":12}}\n',
    ]);
    const text = await collect(openAiToEvents(up));
    expect(events(text, 'done')[0]).toEqual({ usage: { total_tokens: 12 }, len: 3 });
  });
});
