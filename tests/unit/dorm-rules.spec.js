// 住宿分配规则单测（性别楼栋约束）
//
// 被测规则（node-functions/lib/dorm-rules.js）：原为 api/dorm/index.js 分配事务里的内联表达式，
// 抽出来后首次获得测试覆盖。它是"把学生分到错误性别楼栋"这类问题的唯一拦截点。
//
// 编码约定：sys_user.gender 0 未知 / 1 男 / 2 女；dorm_building.gender 'male' / 'female'
import { describe, it, expect } from 'vitest';
import { genderCodeOfBuilding, isGenderMatch } from '../../node-functions/lib/dorm-rules.js';

describe('genderCodeOfBuilding · 楼栋性别编码', () => {
  it('male → 1，female → 2', () => {
    expect(genderCodeOfBuilding('male')).toBe(1);
    expect(genderCodeOfBuilding('female')).toBe(2);
  });

  it('大小写不敏感', () => {
    expect(genderCodeOfBuilding('MALE')).toBe(1);
    expect(genderCodeOfBuilding('Male')).toBe(1);
  });

  it('异常/缺失值落到 2 —— 与原内联实现 (bg === "male" ? 1 : 2) 保持一致', () => {
    expect(genderCodeOfBuilding(undefined)).toBe(2);
    expect(genderCodeOfBuilding(null)).toBe(2);
    expect(genderCodeOfBuilding('')).toBe(2);
    expect(genderCodeOfBuilding('unknown')).toBe(2);
  });
});

describe('isGenderMatch · 性别与楼栋匹配', () => {
  it('男(1) 入男寝 → 允许', () => {
    expect(isGenderMatch(1, 'male')).toBe(true);
  });

  it('男(1) 入女寝 → 拒绝', () => {
    expect(isGenderMatch(1, 'female')).toBe(false);
  });

  it('女(2) 入女寝 → 允许', () => {
    expect(isGenderMatch(2, 'female')).toBe(true);
  });

  it('女(2) 入男寝 → 拒绝', () => {
    expect(isGenderMatch(2, 'male')).toBe(false);
  });

  it('性别未知(0) → 不限制（与原实现一致，允许分配）', () => {
    expect(isGenderMatch(0, 'male')).toBe(true);
    expect(isGenderMatch(0, 'female')).toBe(true);
  });

  it('性别字段缺失或非法 → 按非 0 处理，拒绝（保守）', () => {
    expect(isGenderMatch(undefined, 'male')).toBe(false);
    expect(isGenderMatch(null, 'male')).toBe(false);
    expect(isGenderMatch(NaN, 'male')).toBe(false);
  });

  it('★ 等价性回归：与重构前的内联表达式逐例一致', () => {
    // 原实现（api/dorm/index.js 重构前）：
    //   if (user.gender !== 0 && user.gender !== (room.gender === 'male' ? 1 : 2)) → 拒绝
    // 本断言确保"提取纯函数"这一步没有改变任何输入下的行为
    const legacyRejects = (ug, bg) => ug !== 0 && ug !== (bg === 'male' ? 1 : 2);
    const genders = [0, 1, 2, 3, undefined, null];
    const buildings = ['male', 'female', undefined, ''];
    for (const ug of genders) {
      for (const bg of buildings) {
        expect(isGenderMatch(ug, bg), `gender=${ug} building=${bg}`).toBe(!legacyRejects(ug, bg));
      }
    }
  });
});
