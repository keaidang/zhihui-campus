// tests/unit/ai-c14-c18.spec.js — C14~C18 深度融合能力纯函数单测
//
// 保持测试纯度：零 DB 依赖，秒级运行，完全适配 vitest
import { describe, it, expect } from 'vitest';
import { detectShortcuts } from '../../node-functions/lib/ai-shortcuts.js';
import { checkScheduleConflict } from '../../node-functions/lib/ai-study.js';

describe('C14 问办合一 · detectShortcuts', () => {
  it('识别请假意图并返回请假申请直达路径', () => {
    const sc = detectShortcuts('我想请假三天去医院看病', []);
    expect(sc.some((x) => x.path === '/af/leave')).toBe(true);
    expect(sc.find((x) => x.path === '/af/leave').label).toContain('请假');
  });

  it('识别报修意图并返回宿舍报修路径（带 query tab=repair）', () => {
    const sc = detectShortcuts('宿舍水管漏水空调坏了怎么报修', []);
    expect(sc.some((x) => x.path === '/dorm')).toBe(true);
    const item = sc.find((x) => x.path === '/dorm');
    expect(item.query?.tab).toBe('repair');
  });

  it('识别选课意图并返回选课页面路径', () => {
    const sc = detectShortcuts('大二下学期通识选课什么时候截止', []);
    expect(sc.some((x) => x.path === '/edu/elect')).toBe(true);
  });

  it('识别图书借阅意图', () => {
    const sc = detectShortcuts('图书馆怎么续借图书', []);
    expect(sc.some((x) => x.path === '/library')).toBe(true);
  });

  it('依据知识库命中分类触发直达路径', () => {
    const sc = detectShortcuts('这个事情去哪里办', [{ category: 'leave' }]);
    expect(sc.some((x) => x.path === '/af/leave')).toBe(true);
  });

  it('支持错别字「保修」与「宿舍空调坏了」精准命中报修直达', () => {
    const sc = detectShortcuts('宿舍空调坏了怎保修', [{ title: '宿舍坏了怎么报修？', category: '常见问题' }]);
    expect(sc.some((x) => x.path === '/dorm')).toBe(true);
    expect(sc.find((x) => x.path === '/dorm').query?.tab).toBe('repair');
  });

  it('退课换一门不误判为报修，且精准识别选课', () => {
    const sc = detectShortcuts('我想退课换一门', []);
    expect(sc.some((x) => x.path === '/edu/elect')).toBe(true);
    expect(sc.some((x) => x.path === '/dorm')).toBe(false);
  });

  it('识别口语表达「借的书快到期了怎么还」命中图书借阅', () => {
    const sc = detectShortcuts('借的书快到期了怎么还', []);
    expect(sc.some((x) => x.path === '/library')).toBe(true);
  });

  it('直达推荐最多返回 3 条且路径去重', () => {
    const sc = detectShortcuts('请假退课借书报修宿舍失物招领', []);
    expect(sc.length).toBeLessThanOrEqual(3);
    const paths = sc.map((x) => x.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('C16 智能排课与选课避坑 · checkScheduleConflict', () => {
  const currentSlots = [
    { week_day: 1, section: '1-2节', course_name: '高等数学' },
    { week_day: 3, section: '3-4节', course_name: '大学物理' },
    { week_day: 5, section: '7-8节', course_name: '思想道德与法治' },
  ];

  it('无冲突时返回 null', () => {
    const conflict = checkScheduleConflict(1, '3-4节', currentSlots);
    expect(conflict).toBeNull();

    const conflict2 = checkScheduleConflict(2, '1-2节', currentSlots);
    expect(conflict2).toBeNull();
  });

  it('相同星期且相同节次命中冲突', () => {
    const conflict = checkScheduleConflict(1, '1-2节', currentSlots);
    expect(conflict).toBe('高等数学');
  });

  it('节次子串包含命中冲突', () => {
    const conflict = checkScheduleConflict(3, '3-4', currentSlots);
    expect(conflict).toBe('大学物理');
  });

  it('空课表安全不报错', () => {
    expect(checkScheduleConflict(1, '1-2节', [])).toBeNull();
    expect(checkScheduleConflict(1, '1-2节', null)).toBeNull();
  });
});
