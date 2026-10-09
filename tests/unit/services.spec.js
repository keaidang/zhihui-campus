// 服务层纯逻辑单测（lib/services/_actor.js + users.js 的 parseValidUntil）
//
// 为什么值得测：
//   · `auditDetail` 决定 AI 触发的操作在 sys_op_log 里是否带 `via:ai` —— 铁律 #4 要求
//     "AI 触发的写操作必须可追溯"，漏了这个标记就分不清是人工还是 AI 干的
//   · `parseValidUntil` 是时区换算（北京日历日 → UTC 墙钟），这类逻辑一旦错就是 8 小时偏差，
//     且"看起来正常"（日期对、时刻错），是最难在页面发现的一类 bug（铁律 #25）
import { describe, it, expect } from 'vitest';
import { auditDetail, hasRole, isAdmin } from '../../node-functions/lib/services/_actor.js';
import { parseValidUntil } from '../../node-functions/lib/services/users.js';

describe('_actor · 角色判定', () => {
  it('hasRole 命中任一角色即为真', () => {
    const actor = { roles: ['counselor'] };
    expect(hasRole(actor, ['counselor', 'admin'])).toBe(true);
    expect(hasRole(actor, ['admin'])).toBe(false);
  });

  it('★ roles 缺失/为空一律返回 false（防御式默认拒绝）', () => {
    expect(hasRole({}, ['admin'])).toBe(false);
    expect(hasRole({ roles: [] }, ['admin'])).toBe(false);
    expect(hasRole(null, ['admin'])).toBe(false);
    expect(hasRole(undefined, ['admin'])).toBe(false);
  });

  it('isAdmin 只认 admin', () => {
    expect(isAdmin({ roles: ['admin'] })).toBe(true);
    expect(isAdmin({ roles: ['admin', 'student'] })).toBe(true);
    expect(isAdmin({ roles: ['leader'] })).toBe(false);
    expect(isAdmin({ roles: ['counselor'] })).toBe(false);
  });
});

describe('_actor · 审计详情（铁律 #4：AI 触发必须可追溯）', () => {
  it('人工操作原样返回', () => {
    expect(auditDetail({ userId: 1 }, 'user:5')).toBe('user:5');
  });

  it('★ AI 触发的操作打上 via:ai 标记', () => {
    expect(auditDetail({ userId: 1, viaAi: true }, 'count=12')).toBe('via:ai count=12');
  });

  it('null / undefined 不产生 "null" 字样污染日志', () => {
    expect(auditDetail({ userId: 1 }, null)).toBe('');
    expect(auditDetail({ userId: 1 }, undefined)).toBe('');
  });

  it('超长 detail 截断到 512（与 opLog 的列宽一致）', () => {
    expect(auditDetail({ userId: 1 }, 'x'.repeat(900)).length).toBe(512);
    expect(auditDetail({ userId: 1, viaAi: true }, 'x'.repeat(900)).length).toBe(512);
  });
});

describe('users.parseValidUntil · 有效期时区换算（铁律 #25）', () => {
  it('★ 北京日历日 → 当天 23:59:59 对应的 UTC 墙钟（15:59:59）', () => {
    expect(parseValidUntil('2026-12-31')).toBe('2026-12-31 15:59:59');
  });

  it('带时间部分时只取日期（用户输入的永远是日历日）', () => {
    expect(parseValidUntil('2027-01-01 09:00:00')).toBe('2027-01-01 15:59:59');
  });

  it('空值 → null（表示长期有效，不是异常）', () => {
    expect(parseValidUntil('')).toBeNull();
    expect(parseValidUntil(null)).toBeNull();
    expect(parseValidUntil(undefined)).toBeNull();
  });

  it('格式非法 → 抛 41001（而不是静默塞进库）', () => {
    for (const bad of ['2026/12/31', '20261231', 'abc', '12-31']) {
      expect(() => parseValidUntil(bad), bad).toThrowError();
      try {
        parseValidUntil(bad);
      } catch (e) {
        expect(e.code).toBe(41001);
      }
    }
  });
});
