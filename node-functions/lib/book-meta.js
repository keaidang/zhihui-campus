// node-functions/lib/book-meta.js — 图书分类等元信息（单一事实来源）
//
// 为什么单独一个文件：分类列表原先写死在 api/lib/books.js 里，
// 而 C12 图书自然语言检索需要**同一份**分类（模型只能从这些分类里选）。
// 两处各写一份，迟早出现"AI 说这是计算机类、入库时却变成综合类"的漂移。
// 注意依赖方向：本文件不依赖任何 AI 模块，所以 handler 可以放心引用。

/** 图书分类（入库校验、检索筛选、AI 分类抽取三处共用） */
export const LIB_CATEGORIES = ['计算机', 'AI', '金融', '文学', '历史', '科学', '艺术', '教育', '综合'];

/** 归一化分类：不在白名单内一律落到「综合」 */
export function normalizeCategory(v) {
  const s = String(v ?? '').trim();
  return LIB_CATEGORIES.includes(s) ? s : '综合';
}
