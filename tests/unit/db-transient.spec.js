// DB 层单测：瞬时错误判定 isTransient —— 自动重试白名单的唯一判据
// 误判的两种代价都很高：
//   把真瞬时判成 false → 线上 TiDB 抖动直接透给用户（偶发 500）；
//   把业务/配置错误判成 true → 对写操作盲目重试，掩盖真实缺陷并可能重复执行副作用。
// 本文件是 2026-10-14「单词级子串收窄」的回归防线。
import { describe, it, expect } from 'vitest';
import { isTransient } from '../../node-functions/lib/db.js';

describe('isTransient · 连接层瞬时错误应当重试', () => {
  it('按错误码判定：TRANSIENT 名单内的一律瞬时', () => {
    expect(isTransient({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransient({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransient({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isTransient({ code: 'PROTOCOL_CONNECTION_LOST' })).toBe(true);
    expect(isTransient({ code: 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' })).toBe(true);
  });

  it('TiDB/MySQL 断连 errno：2006 服务器断开 / 2013 查询中失去连接 / 4031 等待超时', () => {
    expect(isTransient({ errno: 2006 })).toBe(true);
    expect(isTransient({ errno: 2013 })).toBe(true);
    expect(isTransient({ errno: 4031 })).toBe(true);
  });

  it('连接层消息：坏包 / 握手 / 连接丢失 / socket 断开 / 连接超时', () => {
    expect(isTransient({ message: 'malform packet error' })).toBe(true);
    expect(isTransient({ message: 'read ECONNRESET' })).toBe(true);
    expect(isTransient({ message: 'Connection lost: server closed the connection' })).toBe(true);
    expect(isTransient({ message: 'TLS handshake timeout' })).toBe(true);
    expect(isTransient({ message: 'bad handshake' })).toBe(true);
    expect(isTransient({ message: 'socket hang up' })).toBe(true);
    expect(isTransient({ message: 'connect ETIMEDOUT 10.0.0.1:4000' })).toBe(true);
    expect(isTransient({ message: 'Too many connections' })).toBe(true);
    expect(isTransient({ message: 'MySQL server has gone away' })).toBe(true);
    expect(isTransient({ message: 'Connection terminated abruptly' })).toBe(true);
  });

  it('空值与无信息错误不判为瞬时', () => {
    expect(isTransient(null)).toBe(false);
    expect(isTransient(undefined)).toBe(false);
    expect(isTransient({})).toBe(false);
    expect(isTransient({ message: '' })).toBe(false);
  });
});

describe('isTransient · 收窄后：业务与配置错误不得重试', () => {
  it('唯一键/约束等业务错误不是瞬时', () => {
    expect(isTransient({ code: 'ER_DUP_ENTRY' })).toBe(false);
    expect(isTransient({ errno: 1062, message: "Duplicate entry 'x' for key 'PRIMARY'" })).toBe(false);
    expect(isTransient({ errno: 1048, message: "Column 'id' cannot be null" })).toBe(false);
  });

  it('证书/SSL 配置错误不是瞬时（旧版被 ssl 单词子串误判）', () => {
    expect(isTransient({ message: 'SSL certificate verify failed' })).toBe(false);
    expect(isTransient({ message: 'self signed certificate in certificate chain' })).toBe(false);
  });

  it('语义已定的超时与中止不是瞬时（旧版被 timeout/aborted/terminated 误判）', () => {
    expect(isTransient({ message: 'Query execution timeout' })).toBe(false);
    expect(isTransient({ message: 'Statement aborted by user' })).toBe(false);
    expect(isTransient({ message: 'Query terminated' })).toBe(false);
  });

  it('权限与库表错误不是瞬时', () => {
    expect(isTransient({ errno: 1045, message: "Access denied for user 'u'@'h'" })).toBe(false);
    expect(isTransient({ errno: 1146, message: "Table 'db.t' doesn't exist" })).toBe(false);
  });
});
