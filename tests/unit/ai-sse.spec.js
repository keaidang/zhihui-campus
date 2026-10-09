// SSE 流式封装单测（node-functions/lib/sse.js 的纯逻辑部分）
//
// 为什么值得测：流式链路一旦格式出错，前端会**静默地什么都不显示**（解析不到 delta），
// 比整段返回更难排查。所以协议格式与上游解析必须有断言。
// 不测 pipeUpstreamWithTap 的真实网络路径（那需要上游，已由 working/sse-test.mjs 端到端验证）。
import { describe, it, expect } from 'vitest';
import { sseEvent, parseUpstreamDelta, textToSseStream, SSE_HEADERS } from '../../node-functions/lib/sse.js';

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
