// C2 论坛 AI 审核单测（lib/ai-review.js 的纯函数）
//
// 为什么值得测：审核判定的**输出规范化**是"宁松勿紧 vs 不漏放"的平衡点。
// 模型返回的 verdict 一旦被误当成合法值（例如大小写、"OK "、拼错），
// 要么把正常内容拦下来（伤用户），要么把该拦的当正常放行（伤合规）。
import { describe, it, expect } from 'vitest';
import { REVIEW_CATEGORIES, excerptOf, normalizeVerdict } from '../../node-functions/lib/ai-review.js';

describe('normalizeVerdict · 模型输出规范化', () => {
  it('合法 verdict 原样保留', () => {
    for (const v of ['ok', 'suspect', 'violation']) {
      expect(normalizeVerdict({ verdict: v }).verdict).toBe(v);
    }
  });

  it('大小写与空白容错', () => {
    expect(normalizeVerdict({ verdict: ' VIOLATION ' }).verdict).toBe('violation');
    expect(normalizeVerdict({ verdict: 'Ok' }).verdict).toBe('ok');
  });

  it('★ 非法/缺失 verdict 一律降级为 suspect（不能凭空放行，也不能凭空空拦）', () => {
    for (const bad of [undefined, null, '', 'block', 'bad', 123, {}, { verdict: '攻击' }]) {
      expect(normalizeVerdict(bad).verdict).toBe('suspect');
    }
  });

  it('分类只保留白名单内的项（防止自由发挥把统计口径搞散）', () => {
    const r = normalizeVerdict({ verdict: 'violation', categories: ['广告', '瞎编的类别', '辱骂', '', null] });
    expect(r.categories).toEqual(['广告', '辱骂']);
  });

  it('分类非数组 → 空数组（不抛异常）', () => {
    expect(normalizeVerdict({ categories: '广告' }).categories).toEqual([]);
    expect(normalizeVerdict({}).categories).toEqual([]);
  });

  it('分类最多保留 4 个（列表页只显示得下这么多）', () => {
    const r = normalizeVerdict({ categories: REVIEW_CATEGORIES.concat(['广告']) });
    expect(r.categories.length).toBeLessThanOrEqual(4);
  });

  it('confidence 夹到 [0,1]，非法值归 0', () => {
    expect(normalizeVerdict({ confidence: 1.7 }).confidence).toBe(1);
    expect(normalizeVerdict({ confidence: -3 }).confidence).toBe(0);
    expect(normalizeVerdict({ confidence: 0.42 }).confidence).toBe(0.42);
    expect(normalizeVerdict({ confidence: 'abc' }).confidence).toBe(0);
    expect(normalizeVerdict({}).confidence).toBe(0);
  });

  it('reason 截断到 200 字（列宽限制）', () => {
    expect(normalizeVerdict({ reason: 'x'.repeat(500) }).reason.length).toBe(200);
  });

  it('空对象也能安全返回完整结构', () => {
    expect(normalizeVerdict({})).toEqual({ verdict: 'suspect', categories: [], confidence: 0, reason: '' });
  });
});

describe('excerptOf · 复核队列摘要', () => {
  it('标题 + 正文合并、折叠空白', () => {
    expect(excerptOf('出  租', '床位\n\n一个')).toBe('出 租 床位 一个');
  });

  it('超长截断并加省略号', () => {
    const s = excerptOf('t', 'x'.repeat(300), 20);
    expect(s.length).toBe(21); // 20 字 + 省略号
    expect(s.endsWith('…')).toBe(true);
  });

  it('null / undefined 安全', () => {
    expect(excerptOf(null, undefined)).toBe('');
    expect(excerptOf(undefined, null)).toBe('');
  });

  it('短内容不加省略号', () => {
    expect(excerptOf('求助', '宿舍灯坏了')).toBe('求助 宿舍灯坏了');
  });
});
