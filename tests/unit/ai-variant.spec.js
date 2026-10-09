// AI 能力分级单测（node-functions/lib/ai-variant.js）
//
// 为什么值得测：这张表决定"谁能用哪些 AI 能力"，是**权限边界**。
// 一个 `roles: null` 写错就可能让校领导拿到写操作，或者让普通学生看到管理入口。
// 因此对"累加式分级"的每一档都做正反两向断言。
import { describe, it, expect } from 'vitest';
import {
  FEATURES,
  VARIANT_META,
  featureAllowed,
  featureCatalog,
  resolveFeatures,
  suggestionsFor,
  variantOf,
} from '../../node-functions/lib/ai-variant.js';

const ALL_ON = Object.fromEntries(FEATURES.map((f) => [f.config, '1']));

describe('variantOf · 角色 → 版本（含多角色取高）', () => {
  it('单角色映射', () => {
    expect(variantOf(['student'])).toBe('standard');
    expect(variantOf(['teacher'])).toBe('standard');
    expect(variantOf(['counselor'])).toBe('counselor');
    expect(variantOf(['leader'])).toBe('leader');
    expect(variantOf(['admin'])).toBe('admin');
  });

  it('★ admin 同时拥有 student 角色时取 admin 版（累加式，不是取第一个）', () => {
    expect(variantOf(['admin', 'student'])).toBe('admin');
    expect(variantOf(['student', 'admin'])).toBe('admin');
  });

  it('leader 兼 counselor 取 leader 版', () => {
    expect(variantOf(['counselor', 'leader'])).toBe('leader');
  });

  it('未知/空角色退化为最保守的标准版（不能因为数据脏就放宽权限）', () => {
    expect(variantOf([])).toBe('standard');
    expect(variantOf(['ghost'])).toBe('standard');
  });

  it('每档都有中文名（前端要显示）', () => {
    for (const v of ['standard', 'counselor', 'leader', 'admin']) {
      expect(VARIANT_META[v].label).toBeTruthy();
      expect(VARIANT_META[v].desc).toBeTruthy();
    }
  });
});

describe('featureAllowed · 能力可见性', () => {
  it('roles=null 的能力对全员开放', () => {
    const chat = FEATURES.find((f) => f.key === 'chat');
    expect(featureAllowed(chat, ['student'])).toBe(true);
    expect(featureAllowed(chat, ['teacher', 'admin'])).toBe(true);
    expect(featureAllowed(chat, [])).toBe(false); // 无角色 = 未登录
  });

  it('★ 学生看不到写操作能力', () => {
    const act = FEATURES.find((f) => f.key === 'adminAction');
    expect(featureAllowed(act, ['student'])).toBe(false);
    expect(featureAllowed(act, ['counselor'])).toBe(false);
    expect(featureAllowed(act, ['leader'])).toBe(false);
    expect(featureAllowed(act, ['admin'])).toBe(true);
  });

  it('★ 校领导只有只读问数，没有写操作', () => {
    expect(featureAllowed(FEATURES.find((f) => f.key === 'insight'), ['leader'])).toBe(true);
    expect(featureAllowed(FEATURES.find((f) => f.key === 'adminAction'), ['leader'])).toBe(false);
  });

  it('学业助手只给学生（教师不应看到"我的成绩"）', () => {
    const study = FEATURES.find((f) => f.key === 'study');
    expect(featureAllowed(study, ['student'])).toBe(true);
    expect(featureAllowed(study, ['teacher'])).toBe(false);
    expect(featureAllowed(study, ['admin'])).toBe(false);
  });
});

describe('resolveFeatures · 开关解析', () => {
  it('默认值生效：问答默认开、论坛审核类默认关', () => {
    const f = resolveFeatures(['student'], {}, true);
    expect(f.chat).toBe(true); // def '1'
    expect(f.libSearch).toBe(true); // def '1'
    expect(f.triage).toBe(false); // def '0'
  });

  it('★ 未配置密钥时全部为 false（前端据此整体隐藏入口）', () => {
    const f = resolveFeatures(['admin'], ALL_ON, false);
    expect(Object.values(f).every((v) => v === false)).toBe(true);
  });

  it('sys_config 的值覆盖默认值', () => {
    expect(resolveFeatures(['student'], { 'ai.chat.enabled': '0' }, true).chat).toBe(false);
    expect(resolveFeatures(['admin'], { 'ai.triage.enabled': '1' }, true).triage).toBe(true);
  });

  it('只返回该角色可见的键（学生不该看到 adminAction 这个键本身）', () => {
    const f = resolveFeatures(['student'], ALL_ON, true);
    expect(f).not.toHaveProperty('adminAction');
    expect(f).not.toHaveProperty('insight');
    expect(f).toHaveProperty('chat');
  });

  it('大小写/宽松真值：true 也算开', () => {
    expect(resolveFeatures(['student'], { 'ai.chat.enabled': 'true' }, true).chat).toBe(true);
    expect(resolveFeatures(['student'], { 'ai.chat.enabled': 'TRUE' }, true).chat).toBe(true);
  });

  it('值写成 2 之类的脏数据视为关（宁可少给能力，不可越权）', () => {
    expect(resolveFeatures(['student'], { 'ai.chat.enabled': '2' }, true).chat).toBe(false);
  });
});

describe('featureCatalog · 前端渲染目录', () => {
  it('带中文名与只读/可写标记', () => {
    const cat = featureCatalog(['admin'], resolveFeatures(['admin'], ALL_ON, true));
    const action = cat.find((c) => c.key === 'adminAction');
    expect(action.label).toBe('智能系统管理');
    expect(action.mode).toBe('write');
    expect(action.on).toBe(true);
  });

  it('学生的目录里没有管理模式项', () => {
    const cat = featureCatalog(['student'], resolveFeatures(['student'], ALL_ON, true));
    expect(cat.some((c) => c.mode === 'write')).toBe(false);
  });
});

describe('suggestionsFor · 候选问题', () => {
  it('管理员版优先给管理类问题', () => {
    const s = suggestionsFor('admin');
    expect(s.length).toBeGreaterThan(0);
    expect(s.some((x) => x.includes('禁用账号'))).toBe(true);
  });

  it('校领导版优先给问数类问题', () => {
    expect(suggestionsFor('leader').some((x) => x.includes('请假'))).toBe(true);
  });

  it('标准版有通用问题兜底（不能让用户面对空白的"能问什么"）', () => {
    const s = suggestionsFor('standard');
    expect(s.length).toBe(6);
    expect(s.some((x) => x.includes('选课'))).toBe(true);
  });

  it('limit 生效且最小为 1', () => {
    expect(suggestionsFor('admin', 3)).toHaveLength(3);
    expect(suggestionsFor('standard', 0)).toHaveLength(1);
  });
});
