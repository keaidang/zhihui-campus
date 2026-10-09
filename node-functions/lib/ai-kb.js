// node-functions/lib/ai-kb.js — 校园知识库（L0 固定档案 + L1 条目库）与知识注入策略
//
// 两级注入（见 docs/AI-FEATURES.md §5.1）：
//   L0 固定档案：常驻 system prompt 的小段常量（校名/角色/功能域/部门/术语）
//   L1 条目库  ：ai_kb 表。总字数 ≤ 阈值 → **全量注入**；超出 → **关键词召回 TopK**
// 之所以能全量注入：本项目知识库规模可控（≤8000 字），配合上游上下文缓存，
// 成本低于"检索链路"，且准确率更高（ADR-9 已澄清：禁整篇塞上下文针对的是长文档/大语料）。
//
// 不引分词库：中文检索靠「n-gram 候选 + 关键词字段人工标注」打分，纯函数便于单测。

/** L0 固定档案 —— 每条都必须与系统真实实现一致（依据 docs/AI-KB-SOURCES.md） */
export const KB_PROFILE = [
  '学校：清北大学（虚拟演示学校）。平台名称：智汇校园 —— 一站式智慧校园服务平台。',
  '五类账号角色：学生 student、教师 teacher、辅导员 counselor、校领导 leader、超级管理员 admin。',
  '功能域共 12 个：统一认证、教务（选课/成绩/课表）、学工（请销假/报修/公告）、宿舍管理、校园邮箱、图书借阅、失物招领、社团活动、校园论坛（含交易集市）、站内信/消息中心、数据驾驶舱（仅 admin 与 leader 可看，全校只读）、个人信息与账号安全。',
  '教学院系 6 个；行政部门 10 个：校长室、党委办公室、教务处、学生工作处、校团委、人事处、财务处、招生就业处、后勤保障处、图书馆。',
  '关键术语：教学班=某课程在特定学期由某教师开设的具体班级（有容量上限）；选课=学生加入教学班；销假=请假结束返校后的登记；工单=报修单；在住=当前分配有效。',
  '重要口径：本平台**没有**在线缴费、成绩申诉、图书续借、宿舍换宿申请、奖助学金申请入口、在线订餐等功能。若被问到，如实说明"平台暂未提供该功能"。',
].join('\n');

const CACHE_TTL = 60_000;
let cache = { at: 0, rows: null };

/** 中文停用词（用于过滤 n-gram 噪声） */
const STOP = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '有', '和', '与', '或', '吗', '呢', '吧', '啊',
  '怎么', '如何', '什么', '哪些', '哪个', '哪里', '可以', '能否', '能不能', '需要', '要不要', '请问', '一下', '告诉', '介绍',
  '关于', '以及', '还有', '就是', '是否', '多少', '为什么', '为什', '一个', '这个', '那个', '我们', '你们', '我想', '帮我',
]);

/**
 * 归一化：去掉标点与空白，只保留中文、字母、数字。
 * 例外：**夹在字母数字之间的 `.` 与 `-` 保留**——否则「GPA 4.0」会变成「40」、
 * 学期代码「2026-2027-1」会变成「202620271」，把有意义的检索关键词毁掉。
 * 中文之间的连字符（如「怎么-办」）仍按标点处理。
 */
export function normalize(s) {
  return String(s || '')
    .replace(/[\s\u3000]+/g, '')
    // 去掉「不属于 字母数字.字母数字」的 . 和 -
    .replace(/(?<![A-Za-z0-9])[.-]|[.-](?![A-Za-z0-9])/g, '')
    // 其余非中文/字母/数字/.- 一律去掉
    .replace(/[^\u4e00-\u9fa5A-Za-z0-9.-]/g, '');
}

/**
 * 抽取候选词：中文 2~4 元 n-gram + 英文/数字词，去停用词、去重。
 * 纯函数，供单测。
 * @returns {string[]} 按长度降序（长词优先，匹配更具体）
 */
export function extractTokens(question) {
  const s = normalize(question);
  if (!s) return [];
  const out = new Set();
  // 英文/数字连续串
  for (const w of s.match(/[a-zA-Z0-9]+/g) || []) {
    if (w.length >= 2) out.add(w.toLowerCase());
  }
  // 中文 n-gram（2~4）
  const cjk = s.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= cjk.length; i++) {
      const g = cjk.slice(i, i + n);
      if (STOP.has(g)) continue;
      // 整串都由停用字组成（如「的了吗」）也丢掉，避免纯噪声 token
      if ([...g].every((c) => STOP.has(c))) continue;
      out.add(g);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * 单条知识条目打分（纯函数，供单测）
 * 权重：keywords 命中 3 分（人工标注最可信）> title 2 分 > content 命中 1 分（封顶 3）
 * 长词加成：同一个命中，词越长越具体 → 再乘 (len-1)
 */
export function scoreEntry(entry, tokens) {
  const kw = String(entry.keywords || '').toLowerCase();
  const title = String(entry.title || '').toLowerCase();
  const content = String(entry.content || '').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    const w = t.length - 1; // 2 字词 1 分基数，4 字词 3 分基数
    if (kw.includes(t)) score += 3 * w;
    if (title.includes(t)) score += 2 * w;
    if (content.includes(t)) score += Math.min(3, content.split(t).length - 1) * w;
  }
  return score;
}

/** 排序取 TopK（纯函数，供单测） */
export function rankKb(entries, question, topK = 4) {
  const tokens = extractTokens(question);
  if (!tokens.length) return [];
  return entries
    .map((e) => ({ entry: e, score: scoreEntry(e, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.entry.id) - Number(b.entry.id))
    .slice(0, Math.max(1, topK))
    .map((x) => x.entry);
}

/** 读全部启用条目（模块级缓存 60 秒） */
export async function loadKb({ force = false } = {}) {
  if (!force && cache.rows && Date.now() - cache.at < CACHE_TTL) return cache.rows;
  const { query } = await import('./db.js');
  const rows = await query(
    `SELECT id, category, title, keywords, content, sort FROM ai_kb
      WHERE status = 1 ORDER BY sort ASC, id ASC`,
  );
  cache = { at: Date.now(), rows };
  return rows;
}

/** 失效缓存（知识库增删改后调用） */
export function invalidateKbCache() {
  cache = { at: 0, rows: null };
}

/** 知识库总字数（用于判断走全量注入还是检索） */
export async function kbTotalChars() {
  const rows = await loadKb();
  return rows.reduce((n, r) => n + String(r.title).length + String(r.content).length, 0);
}

/** 把条目渲染为注入文本（带编号与出处，便于模型给出引用） */
export function renderEntries(entries) {
  return entries
    .map((e, i) => `【资料${i + 1}｜${e.category}｜${e.title}】\n${e.content}`)
    .join('\n\n');
}

/**
 * 构建知识上下文：按阈值决定"全量注入"还是"关键词召回"
 * @returns {{ text:string, sources:Array<{id,title,category}>, mode:'inline'|'retrieve'|'empty' }}
 */
export async function buildKnowledgeContext(question, { inlineMaxChars = 8000, topK = 4 } = {}) {
  const rows = await loadKb();
  if (!rows.length) return { text: '', sources: [], mode: 'empty' };

  const total = rows.reduce((n, r) => n + String(r.title).length + String(r.content).length, 0);
  if (total <= inlineMaxChars) {
    return {
      text: renderEntries(rows),
      sources: rows.map((r) => ({ id: r.id, title: r.title, category: r.category })),
      mode: 'inline',
    };
  }

  const hit = rankKb(rows, question, topK);
  if (!hit.length) return { text: '', sources: [], mode: 'retrieve' };
  return {
    text: renderEntries(hit),
    sources: hit.map((r) => ({ id: r.id, title: r.title, category: r.category })),
    mode: 'retrieve',
  };
}
