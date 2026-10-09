// AI 知识库检索单测（node-functions/lib/ai-kb.js 的纯函数部分）
//
// 为什么重点测这几个函数：知识库"召回错了"是**静默故障**——AI 会一本正经地
// 基于无关资料作答，页面上看不出异常。所以打分与排序必须有断言兜住。
// 不测含 DB 的 loadKb/buildKnowledgeContext（那属于库体检层，见 npm run check:db）。
import { describe, it, expect } from 'vitest';
import {
  normalize,
  extractTokens,
  scoreEntry,
  rankKb,
  renderEntries,
  isNearDuplicateTitle,
  dedupeByTopic,
} from '../../node-functions/lib/ai-kb.js';

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

// ---------- 话题去重与分数门槛（2026-10-09 线上实测后新增）----------
// 线上现象：问「student1的有效期」时，"参考"里出现了「宿舍分配规则」「交易集市发帖要求」。
// 根因：TopK 只取前 N 个，不判断是否真相关；且知识库里同一话题（短 FAQ + 详细条目）
// 会同时命中，界面上出现两条几乎一样的参考。下面两个函数就是为这两个问题加的。

describe('isNearDuplicateTitle · 同话题判定', () => {
  it('归一化后完全相同 → 同话题', () => {
    expect(isNearDuplicateTitle('怎么退课', '怎么退课？')).toBe(true);
    expect(isNearDuplicateTitle('怎么修改登录密码', '怎么修改登录密码？')).toBe(true);
  });

  it('互相包含 → 同话题（长标题里套着短标题）', () => {
    expect(isNearDuplicateTitle('怎么选课：选课规则与流程', '怎么选课？')).toBe(true);
  });

  it('仅差一两个虚字、bigram 相似 → 同话题', () => {
    expect(isNearDuplicateTitle('忘记密码怎么办', '忘记密码了怎么办？')).toBe(true);
  });

  it('★ 不同话题不误判（宁可漏合，不可错合——错合会丢资料）', () => {
    const pairs = [
      ['请假谁批？要多久？', '请假后怎么销假'],
      ['怎么选课：选课规则与流程', '选课时段冲突规则'],
      ['怎么修改登录密码', '怎么修改邮箱密码'],
      ['图书借阅规则', '宿舍分配规则'],
      ['忘记密码怎么办', '忘记用户名怎么办？'],
    ];
    for (const [a, b] of pairs) {
      expect(isNearDuplicateTitle(a, b), `${a} vs ${b}`).toBe(false);
    }
  });

  it('空标题不判为重复（避免把脏数据全合并成一条）', () => {
    expect(isNearDuplicateTitle('', '')).toBe(false);
    expect(isNearDuplicateTitle('选课', '')).toBe(false);
  });
});

describe('dedupeByTopic · 近似重复合并', () => {
  it('★ 保留正文更完整的那条，而不是分数更高的那条', () => {
    // 短 FAQ 分更高，但它正文只写"详见…"——留下它会让模型看不到真正的规则全文
    const scored = [
      { entry: { id: 43, title: '怎么选课？', content: '详见"怎么选课：选课规则与流程"。' }, score: 56 },
      { entry: { id: 9, title: '怎么选课：选课规则与流程', content: '每条规则都写清楚了，正文很长很长很长很长。' }, score: 48 },
    ];
    const out = dedupeByTopic(scored);
    expect(out).toHaveLength(1);
    expect(out[0].entry.id).toBe(9);
  });

  it('合并后仍按分数降序（排序不能因为替换而乱掉）', () => {
    const scored = [
      { entry: { id: 1, title: '甲话题', content: 'x' }, score: 30 },
      { entry: { id: 2, title: '怎么退课', content: '短' }, score: 20 },
      { entry: { id: 3, title: '怎么退课？', content: '这条正文更长一些' }, score: 15 },
      { entry: { id: 4, title: '乙话题', content: 'y' }, score: 10 },
    ];
    const out = dedupeByTopic(scored);
    expect(out.map((x) => x.entry.id)).toEqual([1, 3, 4]);
    expect(out.map((x) => x.score)).toEqual([30, 15, 10]);
  });

  it('无重复时原样返回', () => {
    const scored = [
      { entry: { id: 1, title: '图书借阅规则', content: 'a' }, score: 5 },
      { entry: { id: 2, title: '宿舍分配规则', content: 'b' }, score: 3 },
    ];
    expect(dedupeByTopic(scored).map((x) => x.entry.id)).toEqual([1, 2]);
  });
});

describe('rankKb · 门槛与去重选项', () => {
  it('minScore 绝对门槛：低于门槛的条目被丢弃', () => {
    const entries = [
      { id: 1, keywords: '选课', title: '选课规则', content: '' }, // 3(keywords)+2(title) = 5
      { id: 2, keywords: '选课', title: '无关条目', content: '选课' }, // 3+1 = 4
    ];
    expect(rankKb(entries, '选课', 5).length).toBe(2); // 默认 minScore=1，两条都过
    expect(rankKb(entries, '选课', 5, { minScore: 5 }).map((e) => e.id)).toEqual([1]);
  });

  it('★ minRatio 相对门槛：与最高分不在同一量级的"顺带命中"被丢弃', () => {
    const entries = [
      { id: 1, keywords: '有效期,账号有效期', title: '账号有效期与停用', content: '' },
      { id: 2, keywords: '住宿', title: '宿舍分配规则', content: '有效期' }, // 仅正文偶然出现"有效期"
    ];
    // 宽松（默认门槛）：两条都召回 —— 这正是线上"参考里混进宿舍分配规则"的成因
    const loose = rankKb(entries, 'student1的有效期', 5, { dedupe: false });
    expect(loose.map((e) => e.id)).toEqual([1, 2]);
    // 加相对门槛后只留同量级的那条
    const strict = rankKb(entries, 'student1的有效期', 5, { minRatio: 0.3, dedupe: false });
    expect(strict.map((e) => e.id)).toEqual([1]);
  });

  it('dedupe 可关闭（对照实验用）', () => {
    const entries = [
      { id: 1, keywords: '退课', title: '怎么退课', content: '正文' },
      { id: 2, keywords: '退课', title: '怎么退课？', content: '更长的正文内容' },
    ];
    expect(rankKb(entries, '怎么退课', 5, { dedupe: false })).toHaveLength(2);
    expect(rankKb(entries, '怎么退课', 5)).toHaveLength(1);
  });

  it('默认参数与历史行为兼容（minScore=1 等价于旧的 score>0）', () => {
    const entries = [{ id: 1, keywords: '', title: '', content: '选课' }];
    expect(rankKb(entries, '选课', 3).map((e) => e.id)).toEqual([1]);
  });
});
