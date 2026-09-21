// HTTP 层单测：统一响应结构、请求体解析、真实 IP 提取、错误出口
// 这些是所有 40+ 个 API 的公共底座，行为一旦变了影响面是全站。
import { describe, it, expect, vi } from 'vitest';
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../node-functions/lib/http.js';

const read = async (res) => JSON.parse(await res.text());

describe('ok / fail · 统一响应结构', () => {
  it('ok：HTTP 200 + code=0 + 安全头齐全', async () => {
    const res = ok({ a: 1 }, 'done');
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ code: 0, message: 'done', data: { a: 1 } });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('ok 默认 message 为 ok、data 为 null', async () => {
    expect(await read(ok())).toEqual({ code: 0, message: 'ok', data: null });
  });

  it('fail：默认 HTTP 400，业务码原样透出，data=null', async () => {
    const res = fail(44001, '参数错误');
    expect(res.status).toBe(400);
    expect(await read(res)).toEqual({ code: 44001, message: '参数错误', data: null });
  });

  it('fail 可指定 HTTP 状态码（403/404/500 等）', () => {
    expect(fail(40301, '无权', 403).status).toBe(403);
    expect(fail(50000, '内部错误', 500).status).toBe(500);
  });

  it('preflight：204 且允许 POST 与 Authorization 头', () => {
    const res = preflight();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });
});

describe('readBody · 请求体解析', () => {
  const post = (body) => new Request('https://x/api', { method: 'POST', body });

  it('空 body → {}（不抛错，交由各端点的字段校验处理）', async () => {
    expect(await readBody(new Request('https://x/api', { method: 'POST' }))).toEqual({});
  });

  it('正常 JSON 解析', async () => {
    expect(await readBody(post('{"action":"create","id":1}'))).toEqual({ action: 'create', id: 1 });
  });

  it('非法 JSON 抛错（对应线上曾出现的 [object Object] / Body already read 场景）', async () => {
    await expect(readBody(post('[object Object]'))).rejects.toThrow();
    await expect(readBody(post('{bad json'))).rejects.toThrow();
  });

  it('超过大小上限抛错（默认 16KB）', async () => {
    await expect(readBody(post('x'.repeat(200)), 10)).rejects.toThrow(/too large/);
  });
});

describe('clientIp · 客户端真实 IP', () => {
  const req = (headers) => new Request('https://x/api', { headers });

  it('x-forwarded-for 取第一个（多级代理只认最外层）', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.9.9.9' }))).toBe('1.2.3.4');
  });

  it('x-real-ip 兜底', () => {
    expect(clientIp(req({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('都没有 → unknown（限流按 IP 计数时不可为 undefined）', () => {
    expect(clientIp(req({}))).toBe('unknown');
  });
});

describe('jsonError · 统一错误出口', () => {
  it('业务错误（带 toResponse）按其自带 code/status 透出，不被吞成 500', async () => {
    const res = jsonError({ toResponse: () => fail(40301, '暂无权限', 403) });
    expect(res.status).toBe(403);
    expect((await read(res)).code).toBe(40301);
  });

  it('未知错误 → 50000 / HTTP 500（并尽力落库，落库失败不影响返回）', async () => {
    // 抑制预期内的错误打印；落库走 import('./db.js') 的失败路径（测试环境无库），已被 catch
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = jsonError(new Error('boom'));
    expect(res.status).toBe(500);
    expect((await read(res)).code).toBe(50000);
    expect(spy).toHaveBeenCalled();
  });
});
