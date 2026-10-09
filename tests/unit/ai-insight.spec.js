// C6 问数 + C4 审批助手单测
//
// 为什么值得测：问数模块的**参数枚举校验是 SQL 注入的最后一道闸**——
// 模型只选模板、参数必须命中白名单，一旦这道闸失效，模型被诱导出的内容就可能进 SQL。
// 审批助手的星期计算错了，会得出"请假期间有课/没课"的错误结论，直接影响审批判断。
import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  canInsight,
  insightCatalog,
  insightPromptFor,
  runInsight,
} from '../../node-functions/lib/ai-insight.js';
import { beijingWeekday, canAdvise, weekdaysInRange } from '../../node-functions/lib/ai-approval.js';

const leader = { userId: 1, roles: ['leader'], deptId: null, ip: '-' };
const admin = { userId: 2, roles: ['admin'], deptId: null, ip: '-' };
const counselor = { userId: 3, roles: ['counselor'], deptId: 3, ip: '-' };
const student = { userId: 4, roles: ['student'], deptId: 3, ip: '-' };

describe('ai-insight · 模板注册表不变量', () => {
  it('★ 至少 10 个模板，且每个都有 label/desc/params/run', () => {
    const keys = Object.keys(TEMPLATES);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const [k, t] of Object.entries(TEMPLATES)) {
      expect(t.label, `${k}.label`).toBeTruthy();
      expect(t.desc, `${k}.desc`).toBeTruthy();
      expect(typeof t.run, `${k}.run`).toBe('function');
      expect(t.params, `${k}.params`).toBeTypeOf('object');
    }
  });

  it('★ 所有 period 参数都必须是枚举且值来自统一白名单（不能自由文本）', () => {
    for (const [k, t] of Object.entries(TEMPLATES)) {
      if (!t.params.period) continue;
      expect(t.params.period.type, `${k}.period`).toBe('enum');
      expect(t.params.period.values).toEqual(['7d', '30d', '180d', 'all']);
    }
  });

  it('★ 时间窗口只允许白名单值：模型给别的值一律拒绝（SQL 注入的最后一道闸）', async () => {
    const evil = ['1 YEAR', "7d' OR 1=1 --", '99999', '', null];
    for (const v of evil) {
      if (v === '' || v === null) continue; // 空值走默认，不算攻击
      // 两道校验哪一道先拦都算通过：一是模板 schema 的 enum 校验，二是 periodDays 的白名单校验
      await expect(runInsight(admin, 'leave_overview', { period: v }), String(v)).rejects.toThrowError(/只能是|时间范围必须是/);
    }
  });

  it('未声明的参数不会引发参数校验错误（会被丢弃，而不是报错）', async () => {
    // 无 DB 环境下最终会以连接错误结束；这里断言的是**错误信息不是参数校验类**
    const err = await runInsight(admin, 'leave_overview', { period: '7d', nonsense: 'x' }).catch((e) => e);
    expect(String(err?.message || '')).not.toMatch(/时间范围必须是|只能是/);
  });
});

describe('ai-insight · 权限', () => {
  it('只有 leader 与 admin 能问数', () => {
    expect(canInsight(leader)).toBe(true);
    expect(canInsight(admin)).toBe(true);
    expect(canInsight(counselor)).toBe(false);
    expect(canInsight(student)).toBe(false);
  });

  it('★ 无权限角色调用 runInsight 被拒（49403），且**先于任何 DB 访问**', async () => {
    await expect(runInsight(student, 'leave_overview', {})).rejects.toThrowError(/没有问数权限/);
    await expect(runInsight(counselor, 'leave_overview', {})).rejects.toThrowError(/没有问数权限/);
  });

  it('目录对无权限角色为空（前端据此不显示入口）', () => {
    expect(insightCatalog(student)).toEqual([]);
    expect(insightCatalog(counselor)).toEqual([]);
    expect(insightCatalog(leader).length).toBeGreaterThanOrEqual(10);
  });

  it('提示词列出全部模板 key，且把枚举白名单写出来（减少模型幻觉）', () => {
    const p = insightPromptFor(leader);
    for (const k of Object.keys(TEMPLATES)) expect(p).toContain(k);
    expect(p).toContain('7d / 30d / 180d / all');
  });

  it('提示词对无权限角色给出明确说明而不是空串', () => {
    expect(insightPromptFor(student)).toContain('没有问数权限');
  });

  it('★ 未知模板 key 被拒（模型不能凭空造模板）', async () => {
    await expect(runInsight(admin, 'drop_table_now', {})).rejects.toThrowError(/无法识别的问数模板/);
  });
});

describe('ai-approval · 星期计算（决定"请假期间有没有课"）', () => {
  it('北京时区取星期：周一=1 … 周日=7（库里是 UTC 墙钟，必须 +8h 再取）', () => {
    // 2026-10-05 是周一（2026-10-09 为周五）
    expect(beijingWeekday('2026-10-05 00:00:00')).toBe(1);
    expect(beijingWeekday('2026-10-09 00:00:00')).toBe(5);
    expect(beijingWeekday('2026-10-11 00:00:00')).toBe(7); // 周日
  });

  it('★ 区间内星期去重且升序（用于 SQL 的 IN 条件）', () => {
    expect(weekdaysInRange('2026-10-05 00:00:00', '2026-10-07 00:00:00')).toEqual([1, 2, 3]);
  });

  it('跨周边界正确包含周日（周日=7，不是 0）', () => {
    expect(weekdaysInRange('2026-10-10 00:00:00', '2026-10-11 00:00:00')).toEqual([6, 7]);
  });

  it('非法/倒置区间返回空数组（不抛异常，避免审批页整页报错）', () => {
    expect(weekdaysInRange('bad', '2026-10-07 00:00:00')).toEqual([]);
    expect(weekdaysInRange('2026-10-07 00:00:00', '2026-10-05 00:00:00')).toEqual([]);
  });

  it('★ 区间上限 60 天：超长请假不会把循环拖爆（结果仍覆盖全部 7 个星期）', () => {
    expect(weekdaysInRange('2026-01-01 00:00:00', '2027-01-01 00:00:00')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('canAdvise 只给辅导员与管理员', () => {
    expect(canAdvise(counselor)).toBe(true);
    expect(canAdvise(admin)).toBe(true);
    expect(canAdvise(student)).toBe(false);
    expect(canAdvise(leader)).toBe(false);
  });
});
