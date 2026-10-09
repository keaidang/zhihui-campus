// P8（C8/C9/C10/C12/C11）纯函数单测
//
// 这些断言锁的是"AI 说错话时系统不会跟着做错事"这条底线：
// 模型可能返回非法枚举、编造 id、超长文本，规范化函数必须把它们收敛到安全值。
import { describe, it, expect } from 'vitest';
import { TRIAGE_DEPTS, TRIAGE_URGENCY, formatTriage, normalizeTriage, parseTriage } from '../../node-functions/lib/ai-triage.js';
import { SUMMARY_MAX, cleanSummary } from '../../node-functions/lib/ai-summary.js';
import { MATCH_THRESHOLD } from '../../node-functions/lib/ai-lf-match.js';
import { normalizeLibQuery, buildBookFilters } from '../../node-functions/lib/ai-lib-search.js';
import { THRESHOLDS } from '../../node-functions/lib/ai-anomaly.js';
import { LIB_CATEGORIES, normalizeCategory } from '../../node-functions/lib/book-meta.js';

describe('C8 报修分诊 · normalizeTriage', () => {
  it('合法枚举原样保留，并补上中文标签', () => {
    const t = normalizeTriage({ urgency: 'urgent', dept: '后勤处水电组', selfService: false, suggestion: '已派单' });
    expect(t.urgency).toBe('urgent');
    expect(t.urgencyLabel).toBe('紧急');
    expect(t.dept).toBe('后勤处水电组');
  });

  it('★ 非法紧急度降级为 normal（不能因为模型乱答就把工单升级/降级）', () => {
    expect(normalizeTriage({ urgency: '超级紧急' }).urgency).toBe('normal');
    expect(normalizeTriage({}).urgency).toBe('normal');
  });

  it('★ 部门不在白名单 → 归到「其他」（防止出现查无此处的部门名）', () => {
    expect(normalizeTriage({ dept: '宇宙维修站' }).dept).toBe('其他');
    for (const d of TRIAGE_DEPTS) expect(normalizeTriage({ dept: d }).dept).toBe(d);
  });

  it('selfService 只认布尔 true（"true"/1 这种字符串不算，宁可让学生等工人）', () => {
    expect(normalizeTriage({ selfService: true }).selfService).toBe(true);
    expect(normalizeTriage({ selfService: 'true' }).selfService).toBe(false);
    expect(normalizeTriage({ selfService: 1 }).selfService).toBe(false);
  });

  it('suggestion 截断到 60 字', () => {
    expect(normalizeTriage({ suggestion: '啊'.repeat(200) }).suggestion.length).toBe(60);
  });

  it('紧急度枚举只有这四档（防止新增档位时忘了改前端配色）', () => {
    expect(TRIAGE_URGENCY).toEqual(['low', 'normal', 'high', 'urgent']);
  });
});

describe('C8 分诊文本 · formatTriage / parseTriage', () => {
  it('往返一致（写入库的文本能被前端解析回结构）', () => {
    const t = normalizeTriage({ urgency: 'high', dept: '网络信息中心', selfService: true, suggestion: '先检查网线' });
    const text = formatTriage(t);
    expect(text).toContain('较急');
    expect(text).toContain('网络信息中心');
    const back = parseTriage(text);
    expect(back.urgencyLabel).toBe('较急');
    expect(back.dept).toBe('网络信息中心');
    expect(back.selfService).toBe(true);
    expect(back.suggestion).toBe('先检查网线');
  });

  it('空值不产生垃圾文本', () => {
    expect(formatTriage(null)).toBe('');
    expect(parseTriage('')).toBeNull();
  });

  it('无法解析时原样返回 raw（不丢信息、不报错）', () => {
    expect(parseTriage('随便一段旧数据').raw).toBe('随便一段旧数据');
  });
});

describe('C9 公告摘要 · cleanSummary', () => {
  it('去掉模型爱加的引号、换行与"摘要："前缀', () => {
    expect(cleanSummary('「选课将于 10 月 8 日开放」')).toBe('选课将于 10 月 8 日开放');
    expect(cleanSummary('摘要：全校停水')).toBe('全校停水');
    expect(cleanSummary('第一行\n第二行')).toBe('第一行 第二行');
  });

  it('★ 硬截断到 80 字（字段与展示位都放不下更长的）', () => {
    expect(cleanSummary('啊'.repeat(300)).length).toBe(SUMMARY_MAX);
  });

  it('空输入返回空串', () => {
    expect(cleanSummary(null)).toBe('');
    expect(cleanSummary('   ')).toBe('');
  });
});

describe('C10 失物匹配 · 阈值', () => {
  it('阈值在合理区间（太低会误报打扰发布者，太高等于没有）', () => {
    expect(MATCH_THRESHOLD).toBeGreaterThanOrEqual(0.5);
    expect(MATCH_THRESHOLD).toBeLessThanOrEqual(0.8);
  });
});

describe('C12 图书检索 · normalizeLibQuery', () => {
  it('分类过白名单，非法分类清空（不硬猜）', () => {
    expect(normalizeLibQuery({ category: '计算机' }).category).toBe('计算机');
    expect(normalizeLibQuery({ category: '武侠小说' }).category).toBe('');
  });

  it('★ LIKE 通配符被剔除（即便参数化，也不该让用户控制通配行为）', () => {
    expect(normalizeLibQuery({ keyword: '数据结构%' }).keyword).toBe('数据结构');
    expect(normalizeLibQuery({ keyword: '_算法_导论' }).keyword).toBe('算法导论');
    expect(normalizeLibQuery({ keyword: 'a\\b' }).keyword).toBe('ab');
  });

  it('关键词截断到 32 字、note 到 40 字', () => {
    expect(normalizeLibQuery({ keyword: '长'.repeat(100) }).keyword.length).toBe(32);
    expect(normalizeLibQuery({ note: '长'.repeat(100) }).note.length).toBe(40);
  });
});

describe('C12 图书检索 · buildBookFilters', () => {
  it('关键词拆词后 OR 匹配，单字词被丢弃', () => {
    const f = buildBookFilters('数据结构 书', '');
    // "书"只有 1 字 → 丢弃，只剩 "数据结构"
    expect(f.params).toEqual(['%数据结构%', '%数据结构%', '%数据结构%']);
    expect(f.sql).toContain('OR');
  });

  it('同时有分类时用 AND 连接，参数顺序与占位符一致', () => {
    const f = buildBookFilters('算法', '计算机');
    expect(f.params).toEqual(['%算法%', '%算法%', '%算法%', '计算机']);
    expect(f.sql).toContain('AND b.category = ?');
  });

  it('★ 无条件时返回空 WHERE（不能返回 "WHERE " 这种会拼出语法错误的串）', () => {
    expect(buildBookFilters('', '').sql).toBe('');
    expect(buildBookFilters('书', '').sql).toBe(''); // 单字词被丢弃后即无条件
  });
});

describe('图书分类 · book-meta 单一事实来源', () => {
  it('合法分类保留，非法落「综合」', () => {
    expect(normalizeCategory('AI')).toBe('AI');
    expect(normalizeCategory('随便写的')).toBe('综合');
    expect(normalizeCategory(null)).toBe('综合');
  });
  it('分类清单非空且无重复', () => {
    expect(LIB_CATEGORIES.length).toBeGreaterThan(3);
    expect(new Set(LIB_CATEGORIES).size).toBe(LIB_CATEGORIES.length);
  });
});

describe('C11 异常监测 · 阈值', () => {
  it('阈值合理（请假比例 0~1、观察窗口为正）', () => {
    expect(THRESHOLDS.leaveRatio).toBeGreaterThan(0);
    expect(THRESHOLDS.leaveRatio).toBeLessThanOrEqual(1);
    expect(THRESHOLDS.leaveWindowDays).toBeGreaterThan(0);
    expect(THRESHOLDS.leaveMinStudents).toBeGreaterThan(0);
  });
});
