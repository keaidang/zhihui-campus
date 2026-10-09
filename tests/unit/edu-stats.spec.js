// 学业统计口径单测（lib/edu-stats.js）
//
// 这些断言锁的是"成绩页面与 AI 学业助手必须给出同一个数"这条产品底线：
// 同一个学生不能看到页面写 3.42、AI 说 3.38。
import { describe, it, expect } from 'vitest';
import { CURRENT_TERM, gradeOf, gpaPoint, summarizeStudies, termLabel } from '../../node-functions/lib/edu-stats.js';

const row = (o = {}) => ({
  term: CURRENT_TERM,
  status: 2,
  score: 85,
  credit: 2,
  course_code: 'C001',
  course_name: '测试课',
  ...o,
});

describe('termLabel · 学期显示名', () => {
  it('把 2026-2027-1 渲染成学年学期中文', () => {
    expect(termLabel('2026-2027-1')).toBe('2026-2027 学年第一学期');
    expect(termLabel('2026-2027-2')).toBe('2026-2027 学年第二学期');
  });
  it('格式不符时原样返回（不抛错，也不编造）', () => {
    expect(termLabel('2026')).toBe('2026');
    expect(termLabel(undefined)).toBe('');
  });
});

describe('gradeOf / gpaPoint · 等级与绩点', () => {
  it('等级边界与成绩单一致', () => {
    expect(gradeOf(90)).toBe('优秀');
    expect(gradeOf(89.9)).toBe('良好');
    expect(gradeOf(60)).toBe('及格');
    expect(gradeOf(59.9)).toBe('不及格');
  });
  it('绩点为 4/3/2/1 档，不及格为 0', () => {
    expect(gpaPoint(95)).toBe(4.0);
    expect(gpaPoint(85)).toBe(3.0);
    expect(gpaPoint(75)).toBe(2.0);
    expect(gpaPoint(60)).toBe(1.0);
    expect(gpaPoint(59)).toBe(0);
    expect(gpaPoint(null)).toBe(0);
  });
});

describe('summarizeStudies · 学分与绩点汇总', () => {
  it('★ 不及格课程：计入"参与学分"但不计入"已获学分"，且不进绩点分母', () => {
    const s = summarizeStudies([
      row({ course_code: 'A', score: 90, credit: 4 }), // 及格 4 学分
      row({ course_code: 'B', score: 50, credit: 3 }), // 不及格 3 学分
    ]);
    expect(s.creditsEarned).toBe(4);
    expect(s.creditsAttempted).toBe(7);
    expect(s.gpa).toBe(4);
    expect(s.failed).toHaveLength(1);
    expect(s.failed[0].courseCode).toBe('B');
  });

  it('★ 无及格课程时绩点为 0 而不是 NaN（曾把"解析不出来"变成错的数字，见铁律 #40）', () => {
    const s = summarizeStudies([row({ score: 30, credit: 2 })]);
    expect(s.gpa).toBe(0);
    expect(Number.isNaN(s.gpa)).toBe(false);
  });

  it('status=1（在修）不计入任何学分统计，但会出现在 inProgress', () => {
    const s = summarizeStudies([row({ course_code: 'A', status: 1, score: null, credit: 3 })]);
    expect(s.creditsEarned).toBe(0);
    expect(s.creditsAttempted).toBe(0);
    expect(s.gradedCount).toBe(0);
    expect(s.inProgress).toHaveLength(1);
  });

  it('status=2 但 score 为 null 的行被忽略（避免把 null 当 0 分算成挂科）', () => {
    const s = summarizeStudies([row({ status: 2, score: null, credit: 3 })]);
    expect(s.gradedCount).toBe(0);
    expect(s.failed).toHaveLength(0);
  });

  it('按学期分组：分别统计门数、学分与不及格数', () => {
    const s = summarizeStudies([
      row({ term: '2025-2026-2', score: 90, credit: 3, course_code: 'A' }),
      row({ term: '2025-2026-2', score: 55, credit: 2, course_code: 'B' }),
      row({ term: '2026-2027-1', score: 70, credit: 4, course_code: 'C' }),
    ]);
    expect(s.byTerm).toHaveLength(2);
    const t2 = s.byTerm.find((x) => x.term === '2025-2026-2');
    expect(t2.courses).toBe(2);
    expect(t2.credits).toBe(3);
    expect(t2.failed).toBe(1);
    expect(t2.label).toBe('2025-2026 学年第二学期');
  });

  it('空输入返回全零（不抛错）', () => {
    const s = summarizeStudies([]);
    expect(s.gpa).toBe(0);
    expect(s.creditsEarned).toBe(0);
    expect(s.byTerm).toEqual([]);
  });
});
