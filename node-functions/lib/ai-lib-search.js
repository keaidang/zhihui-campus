// node-functions/lib/ai-lib-search.js — C12 图书自然语言检索
//
// 定位（docs/AI-FEATURES.md §8.6）：学生说"我想找本讲数据结构的入门书"，
//   系统把它转成对 `lib_book` 的检索，而不是让学生先去猜书名。
//
// ★ 安全设计：模型只做「关键词 + 分类 + 检索方式」的抽取，**不生成 SQL**；
//   分类必须过白名单（LIB_CATEGORIES），关键词只作为 LIKE 参数值传入（参数化，不是拼串）。
//   —— 与 C6 问数同一套思路：模型选择，服务端执行。
//
// 降级：模型未开启/失败时，退化为"把整句话当作关键词做 LIKE 检索"，
//   效果差一些但功能可用（图书检索是基础能力，不该因为 AI 不可用就消失）。
import { aiConfigured, aiJson, logAiUsage } from './ai.js';
import { getBool } from './ai-config.js';
import { query } from './db.js';
import { LIB_CATEGORIES } from './book-meta.js';

const SYSTEM = [
  '你在帮学生把"想找什么书"的口语描述，转成图书馆检索条件。',
  '',
  '【输出】严格输出 JSON，不要任何解释文字：',
  '{"keyword":"<检索关键词，2~8字，书名/主题/作者都可以；没有明确对象时填空字符串>",',
  ` "category":"<${LIB_CATEGORIES.join('|')}|空字符串>",`,
  ' "note":"<一句话告诉学生你按什么在找，20字内>"}',
  '',
  '【规则】',
  '1. keyword 只放**真正要在书里找的主题词**，去掉"我想找""有没有""推荐一下"这类口水话。',
  '2. 举例：「我想找本讲数据结构的入门书」→ keyword="数据结构", category="计算机"',
  '   「有没有讲近代史的书」→ keyword="近代史", category="历史"',
  '   「随便来本小说」→ keyword="", category="文学"',
  '   「找一下《算法导论》」→ keyword="算法导论", category=""',
  '3. 判断不出分类就填空字符串，**不要硬猜**。',
  '4. 分类只能从上面列出的里选，不能自创分类名。',
].join('\n');

/** 规范化模型输出（分类过白名单、关键词截断、剔除特殊字符） */
export function normalizeLibQuery(obj) {
  const keyword = String(obj?.keyword || '')
    .replace(/[%_\\]/g, '') // LIKE 通配符与转义符：即便参数化，也不该让用户控制通配行为
    .trim()
    .slice(0, 32);
  const rawCat = String(obj?.category || '').trim();
  const category = LIB_CATEGORIES.includes(rawCat) ? rawCat : '';
  return { keyword, category, note: String(obj?.note || '').slice(0, 40) };
}

/**
 * 组装检索条件（纯函数，便于单测）
 * 关键词拆词后 OR 匹配，提高召回；单字词丢弃（"书""找"这类会命中一切）
 * @returns {{sql:string, params:Array}}
 */
export function buildBookFilters(keyword = '', category = '') {
  const where = [];
  const params = [];
  const words = String(keyword)
    .split(/[\s，,、]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .slice(0, 3);
  if (words.length) {
    where.push(`(${words.map(() => '(b.title LIKE ? OR b.author LIKE ? OR b.publisher LIKE ?)').join(' OR ')})`);
    for (const w of words) {
      const like = `%${w}%`;
      params.push(like, like, like);
    }
  }
  if (category) {
    where.push('b.category = ?');
    params.push(category);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** 用解析出的条件检索（参数化 LIKE，永不拼串） */
export async function searchBooks({ keyword = '', category = '', limit = 8 } = {}) {
  const f = buildBookFilters(keyword, category);
  return query(
    `SELECT b.id, b.title, b.author, b.publisher, b.category, b.location,
            b.total_copies AS totalCopies, b.available_copies AS availableCopies, b.cover_url AS coverUrl
       FROM lib_book b ${f.sql}
      ORDER BY (b.available_copies > 0) DESC, b.id DESC
      LIMIT ?`,
    [...f.params, Math.max(1, Math.min(20, Number(limit) || 8))],
  );
}

/**
 * 自然语言检索
 * @param {{question:string, userId?:number}} p
 * @returns {Promise<{books:object[], parsed:object, note:string, degraded:boolean}>}
 */
export async function libSearch({ question = '', userId = 0 } = {}) {
  const q = String(question || '').trim().slice(0, 200);
  if (!q) return { books: [], parsed: { keyword: '', category: '' }, note: '请描述你想找什么书', degraded: false };

  let parsed = null;
  const enabled = (await getBool('ai.lib_search.enabled', true)) && aiConfigured();
  if (enabled) {
    const t0 = Date.now();
    const raw = await aiJson({
      system: SYSTEM,
      user: q,
      maxTokens: 150,
      temperature: 0,
      timeoutMs: 6000,
      totalBudgetMs: 7000,
    }).catch(() => null);
    await logAiUsage({
      userId,
      kind: 'lib_search',
      promptTokens: raw?._usage?.prompt_tokens ?? 0,
      completionTokens: raw?._usage?.completion_tokens ?? 0,
      ok: raw ? 1 : 0,
      costMs: Date.now() - t0,
    });
    if (raw) parsed = normalizeLibQuery(raw);
  }

  // 降级：AI 不可用时把整句当关键词（效果差但可用；图书检索是基础能力）
  const degraded = !parsed;
  if (!parsed) {
    // ★ 降级路径也必须剔除 LIKE 通配符（2026-10-10 体检）：
    //   正常路径经 normalizeLibQuery 会去掉 % _ \，但降级分支原实现直接 slice，
    //   于是"AI 挂掉时"用户反而能靠 % 控制通配（如输入 % 命中全部图书）。
    //   行为不该因为"走了降级"而改变安全/功能口径。
    parsed = {
      keyword: String(q).replace(/[%_\\]/g, '').slice(0, 16),
      category: '',
      note: '按原标题关键词检索',
    };
  }

  const books = await searchBooks(parsed);
  return {
    books,
    parsed,
    note:
      parsed.note ||
      (parsed.keyword || parsed.category
        ? `按「${[parsed.keyword, parsed.category].filter(Boolean).join(' / ')}」为你找到 ${books.length} 本`
        : '未识别出明确检索条件'),
    degraded,
  };
}
