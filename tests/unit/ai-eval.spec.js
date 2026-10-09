// AI 效果评估的判定逻辑单测（lib/ai-eval.js）
//
// 为什么这套判定值得单独测：它是**评估报告里所有数字的来源**。
// 判定函数写错了，准确率就是错的 —— 而且错得很隐蔽（数字看起来很正常）。
// 尤其 `judgeQa` 的多关键词语法：首轮评估就因为期望值只写一个词，
// 把"系统召回正确、标题措辞不同"误判成失败（真实事件，见函数注释）。
import { describe, it, expect } from 'vitest';
import { SCENES, falsePositiveRate, judgeInsight, judgeQa, judgeReview, judgeTriage, sceneMeta, violationRecall } from '../../node-functions/lib/ai-eval.js';

describe('评估场景目录 · 不变量', () => {
  it('四个场景的 key 齐备且唯一', () => {
    const keys = SCENES.map((s) => s.key);
    expect(keys).toEqual(['qa', 'triage', 'review', 'insight']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('每个场景都有中文名与说明（页面直接渲染这两个字段）', () => {
    for (const s of SCENES) {
      expect(s.label, s.key).toBeTruthy();
      expect(s.desc, s.key).toBeTruthy();
      expect(typeof s.costTokens, s.key).toBe('boolean');
    }
  });

  it('★ qa 是唯一零 token 场景（它只跑本地检索）；triage/review/insight 必须声明成本', () => {
    expect(SCENES.find((s) => s.key === 'qa').costTokens).toBe(false);
    for (const k of ['triage', 'review', 'insight']) {
      expect(SCENES.find((s) => s.key === k).costTokens, k).toBe(true);
    }
  });

  it('需要开关的场景必须写明 sys_config 键（否则评估会静默跑出全失败）', () => {
    expect(SCENES.find((s) => s.key === 'triage').need).toBe('ai.triage.enabled');
    expect(SCENES.find((s) => s.key === 'review').need).toBe('ai.forum_review.enabled');
    expect(SCENES.find((s) => s.key === 'qa').need).toBeNull();
  });

  it('sceneMeta 对未知场景返回 null（不抛错）', () => {
    expect(sceneMeta('nope')).toBeNull();
    expect(sceneMeta('qa')?.label).toBeTruthy();
  });
});

describe('judgeQa · 检索命中判定', () => {
  const src = [{ title: '怎么选课：选课规则与流程' }, { title: '开学与校历' }];

  it('标题包含关键词即命中', () => {
    expect(judgeQa('选课', src).ok).toBe(true);
  });

  it('★ 支持多候选关键词（任一命中即算对）——防止条目改标题就把评估判错', () => {
    // 真实事件：条目名是"丢了东西/捡到东西怎么办？"，期望值写死"失物"就判成失败
    const s2 = [{ title: '丢了东西/捡到东西怎么办？' }];
    expect(judgeQa('失物', s2).ok).toBe(false);
    expect(judgeQa('失物|丢了东西|捡到东西', s2).ok).toBe(true);
  });

  it('未命中时把"实际召回了什么"记进 actual（便于排查，不是无理由判错）', () => {
    const r = judgeQa('学分', src);
    expect(r.ok).toBe(false);
    expect(r.actual).toContain('实际召回');
    expect(r.actual).toContain('怎么选课');
  });

  it('完全没召回时如实说明', () => {
    expect(judgeQa('学分', []).actual).toContain('未召回任何条目');
  });

  it('空期望值不判通过（避免漏标注的行被算成对）', () => {
    expect(judgeQa('', src).ok).toBe(false);
    expect(judgeQa('   ', src).ok).toBe(false);
  });
});

describe('judgeTriage · 分诊判定', () => {
  it('★ 部门完全匹配才算通过；紧急度只记录、不作通过标准（它有主观性）', () => {
    const r = judgeTriage('后勤处水电组|urgent', { dept: '后勤处水电组', urgency: 'high' });
    expect(r.ok).toBe(true);
    expect(r.deptOk).toBe(true);
    expect(r.urgencyOk).toBe(false);
  });

  it('部门不匹配即不通过（哪怕紧急度对了）', () => {
    expect(judgeTriage('网络信息中心|high', { dept: '其他', urgency: 'high' }).ok).toBe(false);
  });

  it('未返回判定时给出可读原因，而不是空字符串', () => {
    const r = judgeTriage('后勤处水电组|urgent', null);
    expect(r.ok).toBe(false);
    expect(r.actual).toContain('未返回分诊结果');
  });

  it('expect 缺少紧急度时不崩（只比部门）', () => {
    expect(judgeTriage('后勤处维修组', { dept: '后勤处维修组', urgency: 'normal' }).ok).toBe(true);
  });
});

describe('judgeReview · 内容审核判定', () => {
  it('verdict 完全匹配才算通过', () => {
    expect(judgeReview('violation', { verdict: 'violation' }).ok).toBe(true);
    expect(judgeReview('ok', { verdict: 'suspect' }).ok).toBe(false);
  });

  it('★ 降级判定（超时/失败）单独标记 —— 它不该被当成模型的真实判断能力', () => {
    const r = judgeReview('ok', { verdict: 'suspect', degraded: true });
    expect(r.degraded).toBe(true);
  });

  it('未返回判定时给出可读原因', () => {
    expect(judgeReview('ok', null).actual).toContain('未返回判定结果');
  });
});

describe('judgeInsight · 问数模板判定', () => {
  it('模板 key 匹配才算通过', () => {
    expect(judgeInsight('leave_top_classes', 'leave_top_classes').ok).toBe(true);
    expect(judgeInsight('leave_top_classes', 'leave_dept_rank').ok).toBe(false);
  });

  it('没识别成问数需求（template=null）时给出可读说明', () => {
    const r = judgeInsight('leave_top_classes', null);
    expect(r.ok).toBe(false);
    expect(r.actual).toContain('未识别为问数需求');
  });
});

describe('review 场景的两个附加指标', () => {
  const detail = [
    { expect: 'ok', actual: 'ok', ok: true },
    { expect: 'ok', actual: 'suspect', ok: false },
    { expect: 'ok', actual: 'ok', ok: true },
    { expect: 'violation', actual: 'violation', ok: true },
    { expect: 'violation', actual: 'suspect', ok: false },
  ];

  it('误报率只统计"期望正常"的负例被误判的比例', () => {
    const fp = falsePositiveRate(detail);
    expect(fp.total).toBe(3);
    expect(fp.wrong).toBe(1);
    expect(fp.rate).toBeCloseTo(0.3333, 3);
  });

  it('违规检出率只统计"期望违规"的正例被判出的比例', () => {
    const vr = violationRecall(detail);
    expect(vr.total).toBe(2);
    expect(vr.hit).toBe(1);
    expect(vr.rate).toBe(0.5);
  });

  it('没有负例时返回 null（而不是算成 0% —— 那会把"没测"说成"完美"）', () => {
    expect(falsePositiveRate([{ expect: 'violation', actual: 'violation', ok: true }])).toBeNull();
    expect(violationRecall([{ expect: 'ok', actual: 'ok', ok: true }])).toBeNull();
  });
});
