// AI 知识库检索单测（node-functions/lib/ai-kb.js 的纯函数部分）
//
// 为什么重点测这几个函数：知识库"召回错了"是**静默故障**——AI 会一本正经地
// 基于无关资料作答，页面上看不出异常。所以打分与排序必须有断言兜住。
// 不测含 DB 的 loadKb/buildKnowledgeContext（那属于库体检层，见 npm run check:db）。
import { describe, it, expect } from 'vitest';
import { normalize, extractTokens, scoreEntry, rankKb, renderEntries } from '../../node-functions/lib/ai-kb.js';

describe('normalize · 归一化', () => {
  it('去掉标点、空白、全角空格', () => {
    expect(normalize('选课 怎么-办？')).toBe('选课怎么办');
    expect(normalize('图书馆，借　书！')).toBe('图书馆借书');
  });
  it('保留中文、字母、数字', () => {
    expect(normalize('绩点 GPA 4.0')).toBe('绩点GPA4.0');
  });
  it('夹在字母数字之间的 . 与 - 不被当作标点（学期代码/GPA 不能毁掉）', () => {
    expect(normalize('2026-2027-1 学期')).toBe('2026-2027-1学期');
    expect(normalize('绩点 3.5 以上')).toBe('绩点3.5以上');
  });
  it('中文之间的连字符仍按标点处理', () => {
    expect(normalize('怎么-办')).toBe('怎么办');
  });
  it('孤立的首尾 . 与 - 被去掉', () => {
    expect(normalize('-选课-')).toBe('选课');
    expect(normalize('选课.')).toBe('选课');
  });
  it('空值安全', () => {
    expect(normalize('')).toBe('');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('extractTokens · 候选词抽取', () => {
  it('切出 2~4 元 n-gram 并保留业务词', () => {
    const t = extractTokens('如何选课');
    expect(t).toContain('选课');
    expect(t).toContain('如何选课');
  });

  it('停用词与纯停用字组合被剔除', () => {
    expect(extractTokens('怎么')).not.toContain('怎么');
    expect(extractTokens('的了吗')).toEqual([]);
    expect(extractTokens('如何')).not.toContain('如何');
  });

  it('英文/数字词被保留并小写化', () => {
    expect(extractTokens('查 GPA 成绩')).toContain('gpa');
  });

  it('按长度降序（长词优先，匹配更具体）', () => {
    const t = extractTokens('图书馆借阅规则');
    expect(t[0].length).toBeGreaterThanOrEqual(t[t.length - 1].length);
  });

  it('去重且空值安全', () => {
    const t = extractTokens('选课选课');
    expect(t.length).toBe(new Set(t).size);
    expect(extractTokens('')).toEqual([]);
    expect(extractTokens(null)).toEqual([]);
  });
});

describe('scoreEntry · 条目打分', () => {
  const entry = {
    id: 1,
    keywords: '选课,退课',
    title: '选课规则',
    content: '学生可以在选课中心选课，退课需在开学两周内完成',
  };

  it('关键词命中权重最高（3 分/字基数）', () => {
    // '退课'：keywords 含 → 3×1，content 出现 1 次 → +1 = 4
    expect(scoreEntry(entry, ['退课'])).toBe(4);
  });

  it('title 命中次之（2 分/字基数）', () => {
    // '规则' 只在 title 里 → 2 分
    expect(scoreEntry(entry, ['规则'])).toBe(2);
  });

  it('content 命中最低（1 分/字基数，且单 token 封顶 3 次）', () => {
    // '两周' 只在 content 出现 1 次 → 1 分
    expect(scoreEntry(entry, ['两周'])).toBe(1);
  });

  it('多字段命中累加，长词权重更高', () => {
    // '选课'：keywords 3 + title 2 + content 出现 2 次(封顶3) ×1 = 7
    expect(scoreEntry(entry, ['选课'])).toBe(7);
    // 4 字词基数 3：'选课规则' 只命中 title → 2×3 = 6
    expect(scoreEntry(entry, ['选课规则'])).toBe(6);
  });

  it('无命中得 0 分', () => {
    expect(scoreEntry(entry, ['宿舍分配'])).toBe(0);
  });

  it('空 token 列表得 0 分', () => {
    expect(scoreEntry(entry, [])).toBe(0);
  });
});

describe('rankKb · 召回排序', () => {
  const entries = [
    { id: 1, keywords: '选课', title: '选课规则', content: '选课流程说明' },
    { id: 2, keywords: '请假', title: '请假流程', content: '请假需要辅导员审批' },
    { id: 3, keywords: '宿舍', title: '宿舍分配', content: '宿舍分配规则' },
  ];

  it('按相关度降序返回', () => {
    const hit = rankKb(entries, '请假要谁审批', 3);
    expect(hit[0].id).toBe(2);
  });

  it('topK 截断生效', () => {
    const hit = rankKb(entries, '选课规则和请假流程和宿舍分配', 2);
    expect(hit.length).toBe(2);
  });

  it('全部不相关时返回空数组（而不是随便给一条）', () => {
    expect(rankKb(entries, '今天天气', 3)).toEqual([]);
  });

  it('纯停用词问题返回空数组', () => {
    expect(rankKb(entries, '的了吗呢', 3)).toEqual([]);
  });

  it('同分时按 id 升序稳定排序（结果可复现）', () => {
    const tie = [
      { id: 5, keywords: '选课', title: 'A', content: '' },
      { id: 2, keywords: '选课', title: 'B', content: '' },
    ];
    expect(rankKb(tie, '选课', 2).map((e) => e.id)).toEqual([2, 5]);
  });
});

describe('renderEntries · 注入文本渲染', () => {
  it('带编号与出处，便于模型给出引用', () => {
    const text = renderEntries([{ category: '教务', title: '选课规则', content: '每学期选课。' }]);
    expect(text).toContain('资料1');
    expect(text).toContain('教务');
    expect(text).toContain('选课规则');
    expect(text).toContain('每学期选课。');
  });
  it('空数组返回空串', () => {
    expect(renderEntries([])).toBe('');
  });
});
