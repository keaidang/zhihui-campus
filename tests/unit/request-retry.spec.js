// 请求层单测：5xx 自动重试白名单 —— 只允许**幂等**写操作重放
// 回归背景（2026-10-14）：原实现对所有非 GET 请求遇 5xx 都重试一次，
// 而注册、发验证码邮件、发帖、报名、请假等非幂等操作一旦服务端副作用
// 已产生一半，重试会造成重复发信/重复建单。
import { describe, it, expect } from 'vitest';
import { canRetry5xx } from '../../src/api/request.js';

describe('canRetry5xx · 5xx 自动重试白名单', () => {
  it('GET 不重试（维持收窄前的行为）', () => {
    expect(canRetry5xx('/api/edu/course', 'GET')).toBe(false);
    expect(canRetry5xx('/api/admin/users', 'GET')).toBe(false);
  });

  it('幂等写操作可重试：选课 enroll / 退课 drop', () => {
    expect(canRetry5xx('/api/edu/course', 'POST', { action: 'enroll', classId: 7 })).toBe(true);
    expect(canRetry5xx('/api/edu/course', 'POST', { action: 'drop', classId: 7 })).toBe(true);
  });

  it('同一 URL 上的非幂等 action 不可重试（按 URL+action 而非仅 URL 判定）', () => {
    expect(canRetry5xx('/api/edu/course', 'POST', { action: 'create', name: '高等数学' })).toBe(false);
    expect(canRetry5xx('/api/edu/course', 'POST', { action: 'update', classId: 7 })).toBe(false);
  });

  it('会产生副作用的非幂等端点一律不重试', () => {
    expect(canRetry5xx('/api/auth/register', 'POST', { email: 'a@b.c' })).toBe(false);
    expect(canRetry5xx('/api/auth/login-code-send', 'POST', { email: 'a@b.c' })).toBe(false);
    expect(canRetry5xx('/api/forum/threads', 'POST', { title: '帖子' })).toBe(false);
    expect(canRetry5xx('/api/club/apply', 'POST', { recruitId: 1 })).toBe(false);
    expect(canRetry5xx('/api/af/leave', 'POST', { days: 1 })).toBe(false);
    expect(canRetry5xx('/api/lib/loans', 'POST', { bookId: 1 })).toBe(false);
  });

  it('无 body 或 body 非对象的写请求不重试', () => {
    expect(canRetry5xx('/api/edu/course', 'POST')).toBe(false);
    expect(canRetry5xx('/api/edu/course', 'POST', null)).toBe(false);
    expect(canRetry5xx('/api/edu/course', 'POST', 'enroll')).toBe(false);
  });
});
