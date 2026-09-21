// 权限底座单测：数据范围三层防线、错误码约定、令牌解析
//
// 为什么优先测这里：guard.js 是全部 40+ 个 API 的鉴权入口，
// dataScope 决定"谁能看到谁的数据"——它错一次就是越权事故。
import { describe, it, expect, beforeAll } from 'vitest';
import {
  dataScope,
  getAuth,
  requireAuth,
  ERR_UNAUTHORIZED,
  ERR_FORBIDDEN,
} from '../../node-functions/lib/guard.js';
import { signAccessToken } from '../../node-functions/lib/auth.js';

beforeAll(() => {
  // 仅为单测签发令牌；不读取也不影响任何真实密钥
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-only-secret-32chars-min';
});

describe('dataScope · 数据范围三层防线（all / dept / self）', () => {
  it('admin → 全校', () => {
    expect(dataScope(['admin'], 5)).toEqual({ type: 'all', deptId: null });
  });

  it('leader → 全校', () => {
    expect(dataScope(['leader'], 5)).toEqual({ type: 'all', deptId: null });
  });

  it('counselor + deptId → 本院', () => {
    expect(dataScope(['counselor'], 7)).toEqual({ type: 'dept', deptId: 7 });
  });

  it('counselor 无 deptId → 退回 self（不得因缺院系而放大到全校）', () => {
    expect(dataScope(['counselor'], null)).toEqual({ type: 'self', deptId: null });
    expect(dataScope(['counselor'], 0)).toEqual({ type: 'self', deptId: null });
    expect(dataScope(['counselor'], undefined)).toEqual({ type: 'self', deptId: null });
  });

  it('teacher / student → self', () => {
    expect(dataScope(['teacher'], 3)).toEqual({ type: 'self', deptId: null });
    expect(dataScope(['student'], 3)).toEqual({ type: 'self', deptId: null });
  });

  it('多角色取最高权限（admin 优先于 dept 角色）', () => {
    expect(dataScope(['student', 'admin'], 3)).toEqual({ type: 'all', deptId: null });
    expect(dataScope(['counselor', 'leader'], 3)).toEqual({ type: 'all', deptId: null });
  });

  it('空角色 → self（最小权限兜底）', () => {
    expect(dataScope([], 3)).toEqual({ type: 'self', deptId: null });
  });
});

describe('错误码约定', () => {
  it('未登录：40103 / HTTP 401', () => {
    const e = ERR_UNAUTHORIZED();
    expect(e.code).toBe(40103);
    expect(e.status).toBe(401);
  });

  it('越权：40301 / HTTP 403，且可自定义提示', () => {
    expect(ERR_FORBIDDEN().code).toBe(40301);
    expect(ERR_FORBIDDEN().status).toBe(403);
    expect(ERR_FORBIDDEN('仅辅导员可处理').message).toBe('仅辅导员可处理');
    expect(ERR_FORBIDDEN().message).toBe('暂无权限执行该操作');
  });

  it('toResponse() 产出标准响应体（jsonError 依赖它避免被吞成 500）', async () => {
    const res = ERR_FORBIDDEN('无权操作').toResponse();
    expect(res.status).toBe(403);
    expect(JSON.parse(await res.text())).toEqual({ code: 40301, message: '无权操作', data: null });
  });
});

describe('getAuth / requireAuth · 令牌解析', () => {
  const ctxWith = (authorization) =>
    ({ request: new Request('https://x/api', authorization ? { headers: { authorization } } : {}) });

  it('无 Authorization 头 → null / requireAuth 抛 40103', () => {
    expect(getAuth(ctxWith(undefined))).toBeNull();
    expect(() => requireAuth(ctxWith(undefined))).toThrow(/登录状态已失效/);
  });

  it('非 Bearer 方案（Basic/Token）→ null', () => {
    expect(getAuth(ctxWith('Basic dXNlcjpwYXNz'))).toBeNull();
    expect(getAuth(ctxWith('Token abc.def.ghi'))).toBeNull();
  });

  it('Bearer 空串或伪造串 → null（不抛，交由 requireAuth 统一判定）', () => {
    expect(getAuth(ctxWith('Bearer '))).toBeNull();
    expect(getAuth(ctxWith('Bearer not-a-jwt'))).toBeNull();
  });

  it('有效令牌 → 解出 sub / username / roles', () => {
    const token = signAccessToken({ id: 42, username: 'student004' }, ['student']);
    const payload = getAuth(ctxWith(`Bearer ${token}`));
    expect(payload.sub).toBe('42');
    expect(payload.username).toBe('student004');
    expect(payload.roles).toEqual(['student']);
  });

  it('requireAuth 对有效令牌返回载荷', () => {
    const token = signAccessToken({ id: 7, username: 'admin' }, ['admin']);
    expect(requireAuth(ctxWith(`Bearer ${token}`)).username).toBe('admin');
  });
});
