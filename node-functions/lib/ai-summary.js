// node-functions/lib/ai-summary.js — C9 公告 AI 摘要
//
// 定位（docs/AI-FEATURES.md §8.3）：公告正文往往很长（通知、办法、安排），
//   列表页只显示标题+时间，学生要点进去才知道跟自己有没有关系。
//   发布时用 AI 生成 ≤80 字摘要存 `af_notice.summary`，列表页直接显示。
//
// 设计纪律：
//   ① **纯文本、零成本可控**：只在"管理员确认开启"时调用（默认关），一条公告最多一次调用
//   ② **失败不阻塞发布**：拿不到摘要就存空串，公告照常发出（摘要只是展示增强）
//   ③ **不许编造**：摘要只能压缩原文信息，不能添加原文没有的时间、地点、要求
//   ④ 铁律 #36：不读图片
import { aiConfigured, aiChat, logAiUsage } from './ai.js';
import { getBool } from './ai-config.js';

/** 摘要长度上限（字段 varchar(255)，但展示位只放得下约 80 字） */
export const SUMMARY_MAX = 80;

/**
 * 正文短于这个长度就不生成摘要（本身已经够短，摘要没有意义）。
 * ★ 导出给调用方做前置判断用：否则"补摘要失败"会把"正文太短"误报成
 *   "AI 开关没开或服务不可用"，提示指向错误的原因（2026-10-10 体检发现）。
 */
export const SUMMARY_MIN_CHARS = 40;

const SYSTEM = [
  '你是公告摘要助手。把下面的校园公告压缩成一句话摘要。',
  '',
  '【规则】',
  `1. 不超过 ${SUMMARY_MAX} 个汉字，一句话，不要分段、不要序号、不要小标题。`,
  '2. 优先保留：**谁需要关注**（全校/某院系/某年级）、**要做什么**、**截止时间或生效时间**。',
  '3. 只压缩原文信息，**不得添加**原文没有的时间、地点、金额、联系方式。',
  '4. 不要以"本公告"开头，不要写成"该公告说明……"，直接给信息。',
  '5. 只输出摘要本身，不要任何前缀、引号或解释。',
].join('\n');

/** 清洗模型输出：去引号/换行/前缀，硬截断 */
export function cleanSummary(s) {
  return String(s || '')
    .replace(/^[「『"'\s]*/, '')
    .replace(/[」』"'\s]*$/, '')
    .replace(/^摘要[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUMMARY_MAX);
}

/**
 * 生成公告摘要
 *
 * @returns {Promise<string|null>} null 的四种原因：① 开关未开 ② AI 未配置
 *   ③ AI 调用失败 ④ **正文太短（< SUMMARY_MIN_CHARS，本就不需要摘要）**
 *
 * ★ 调用方需要区分 ④ 时必须自己先比对 SUMMARY_MIN_CHARS —— 因此把阈值导出，
 *   避免"40"这个数字散落到第二处（两处阈值不一致会让提示与行为矛盾）。
 */
export async function summarizeNotice({ title = '', content = '' } = {}) {
  if (!(await getBool('ai.notice_summary.enabled', false))) return null;
  if (!aiConfigured()) return null;
  const text = String(content || '').trim();
  if (text.length < SUMMARY_MIN_CHARS) return null; // 太短的公告本身不需要摘要

  const t0 = Date.now();
  const r = await aiChat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `标题：${String(title).slice(0, 128)}\n正文：\n${text.slice(0, 3000)}` },
    ],
    maxTokens: 160,
    temperature: 0.2,
    timeoutMs: 8000,
  });

  await logAiUsage({
    userId: 0,
    kind: 'summary',
    promptTokens: r?.usage?.prompt_tokens ?? 0,
    completionTokens: r?.usage?.completion_tokens ?? 0,
    ok: r?.content ? 1 : 0,
    costMs: Date.now() - t0,
  });

  if (!r?.content) return null;
  const s = cleanSummary(r.content);
  return s || null;
}
