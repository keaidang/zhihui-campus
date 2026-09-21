// 选课时段冲突单测
//
// 被测规则（node-functions/lib/schedule.js）：原为 api/edu/course.js 内联在选课事务里的逻辑，
// 抽出来后首次获得测试覆盖。这是"改一处影响所有学生选课结果"的高风险判定。
//
// 真实数据格式：edu_class.section = 'N-M节'（schema-003 默认 '1-2节'）
import { describe, it, expect } from 'vitest';
import { parseSection, isScheduleConflict } from '../../node-functions/lib/schedule.js';

describe('parseSection · 节次解析', () => {
  it("真实数据格式 'N-M节'", () => {
    expect(parseSection('1-2节')).toEqual([1, 2]);
    expect(parseSection('3-4节')).toEqual([3, 4]);
    expect(parseSection('9-10节')).toEqual([9, 10]);
  });

  it('无「节」后缀也接受', () => {
    expect(parseSection('1-2')).toEqual([1, 2]);
  });

  it('容忍空格与首尾空白', () => {
    expect(parseSection('1 - 2')).toEqual([1, 2]);
    expect(parseSection('  1-2节  ')).toEqual([1, 2]);
  });

  it('非标准写法返回 null（调用方退化为字符串比较）', () => {
    expect(parseSection('第1-2节')).toBeNull();
    expect(parseSection('上午')).toBeNull();
    expect(parseSection('1-2-3')).toBeNull();
    expect(parseSection('1')).toBeNull();
  });

  it('空值安全', () => {
    expect(parseSection('')).toBeNull();
    expect(parseSection(null)).toBeNull();
    expect(parseSection(undefined)).toBeNull();
  });
});

describe('isScheduleConflict · 冲突判定', () => {
  it('不同星期永不冲突（即使节次相同）', () => {
    expect(isScheduleConflict(1, '1-2节', 2, '1-2节')).toBe(false);
    expect(isScheduleConflict(3, '5-6节', 4, '5-6节')).toBe(false);
  });

  it('星期按数值比较（"1" 与 1 等价）', () => {
    expect(isScheduleConflict('1', '1-2节', 1, '1-2节')).toBe(true);
  });

  it('同星期但节次不重叠 → 不冲突', () => {
    expect(isScheduleConflict(3, '1-2节', 3, '3-4节')).toBe(false);
    expect(isScheduleConflict(3, '5-6节', 3, '1-2节')).toBe(false);
  });

  it('边界相接视为冲突（第 2 节重叠）', () => {
    expect(isScheduleConflict(3, '1-2节', 3, '2-3节')).toBe(true);
  });

  it('包含关系 → 冲突（两个方向都判）', () => {
    expect(isScheduleConflict(3, '1-4节', 3, '2-3节')).toBe(true);
    expect(isScheduleConflict(3, '2-3节', 3, '1-4节')).toBe(true);
  });

  it('完全相同 → 冲突', () => {
    expect(isScheduleConflict(5, '5-6节', 5, '5-6节')).toBe(true);
  });

  it('非标准节次：仅字符串完全相同才算冲突', () => {
    expect(isScheduleConflict(1, '上午', 1, '上午')).toBe(true);
    expect(isScheduleConflict(1, '上午', 1, '下午')).toBe(false);
  });

  it('标准与非标准之间不误判冲突（宁可漏判也不能错拦）', () => {
    expect(isScheduleConflict(1, '上午', 1, '1-2节')).toBe(false);
  });
});
