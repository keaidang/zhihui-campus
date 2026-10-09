// AI 配置接口的类型表单测（api/ai/config.js 的 LABELS）
//
// 为什么值得测：控制台用 `type` 决定渲染成"开关"还是"输入框"。
// 2026-10-09 线上验收发现：原来靠**猜**（值匹配 ^\d+$ 就当数字），
// 而布尔开关的值正好是 '0'/'1' → 全部被猜成数字 → 论坛审核开关被渲染成"修改"按钮。
// 现在类型显式声明，这里把"哪些必须是哪一类"锁住。
import { describe, it, expect } from 'vitest';
import { LABELS } from '../../node-functions/api/ai/config.js';

describe('AI 配置类型表', () => {
  it('★ 开关必须是 bool（不能因为是 0/1 就被当成数字）', () => {
    const bools = [
      'ai.enabled', 'ai.chat.enabled', 'ai.forum_review.enabled', 'ai.forum_review.block_on_violation',
      'ai.alert.enabled', 'ai.approval_advice.enabled', 'ai.admin_console.enabled', 'ai.insight.enabled',
      'ai.study.enabled', 'ai.triage.enabled', 'ai.notice_summary.enabled', 'ai.lf_match.enabled',
      'ai.anomaly.enabled', 'ai.anomaly.explain', 'ai.lib_search.enabled',
    ];
    for (const k of bools) {
      expect(LABELS[k], k).toBeTruthy();
      expect(LABELS[k].type, k).toBe('bool');
    }
  });

  it('阈值/超时/次数类必须是 number', () => {
    for (const k of [
      'ai.chat.rate_per_min', 'ai.chat.daily_per_user', 'ai.forum_review.timeout_ms',
      'ai.alert.dedupe_min', 'ai.approval_advice.timeout_ms', 'ai.kb.inline_max_chars', 'ai.kb.top_k',
      'ai.triage.timeout_ms', 'ai.lf_match.timeout_ms',
    ]) {
      expect(LABELS[k]?.type, k).toBe('number');
    }
  });

  it('收件人必须是 text（可以留空、可以是多个邮箱）', () => {
    expect(LABELS['ai.alert.emails'].type).toBe('text');
  });

  it('★ 25 项配置全部登记且都有中文说明（漏登记会被接口拒绝写入）', () => {
    const keys = Object.keys(LABELS);
    expect(keys.length).toBe(25);
    for (const k of keys) {
      expect(k.startsWith('ai.'), k).toBe(true);
      expect(LABELS[k].label, `${k} 缺中文说明`).toBeTruthy();
      expect(['bool', 'number', 'text']).toContain(LABELS[k].type);
    }
  });

  it('★ 没有任何一项的 type 是 undefined（否则前端会退化成"修改"按钮）', () => {
    for (const [k, v] of Object.entries(LABELS)) expect(v.type, k).toBeTypeOf('string');
  });
});
