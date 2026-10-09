// node-functions/lib/ai-lf-match.js — C10 失物招领智能匹配
//
// 定位（docs/AI-FEATURES.md §8.4）：学工处发布拾获物时，自动比对**已有的招领条目**，
//   命中则提示"可能与某条是同一物品"，避免同一样东西被重复发布、也让失主更快找到。
//
// ★ 为什么用"一次打分"而不是"N 次两两比对"：
//   两两比对是 O(n²) 次调用 —— 40 条候选就是 40 次请求，既慢又贵，且几乎必然超时。
//   这里把候选清单**整体**给模型，让它一次输出"哪几条最像 + 相似度 + 理由"，
//   成本固定为 1 次调用（这是本项目所有 AI 能力的成本原则：一次调用解决一类判断）。
//
// 纪律：
//   ① 超时/失败 → 返回空数组（发布照常，只是没有匹配提示）
//   ② 相似度必须由**服务端再夹一次** [0,1]，且只认候选清单里真实存在的 id
//      （模型可能凭空编 id，若不校验就会通知到不存在的条目上）
//   ③ 铁律 #36：纯文本比对
import { aiConfigured, aiJson, logAiUsage } from './ai.js';
import { getBool, getInt } from './ai-config.js';
import { query } from './db.js';

/** 命中阈值：低于此分不作为"可能是同一物品"提示（宁缺勿滥，误报会打扰发布者） */
export const MATCH_THRESHOLD = 0.6;
const CANDIDATE_LIMIT = 40;
const DESC_MAX = 60;

const SYSTEM = [
  '你在做校园失物招领的**同一物品**判断。给你一条"新发布的拾获物品"和若干"已有条目"，',
  '请判断哪些已有条目**很可能就是同一件东西**。',
  '',
  '【判断依据】物品类别、颜色、品牌、型号、明显特征、拾获地点是否吻合。',
  '- 同一件东西：同类物品 + 关键特征吻合（例如"蓝色保温杯 印有卡通猫"与"蓝色水杯 有猫咪图案"）',
  '- 不是同一件：只是类别相同（例如两条都是"雨伞"，但一条是黑伞、一条是格子伞）',
  '- 类别相同但特征不同 → 给低分（0.2~0.4），不要给高分',
  '',
  '【输出】严格输出 JSON，不要任何解释文字：',
  '{"matches":[{"id":<候选项的 id 数字>,"score":0.0~1.0,"reason":"10字内理由"}]}',
  '',
  '只输出你确实认为相似的（score ≥ 0.5）；没有相似的输出 {"matches":[]}。',
  '**id 必须是上面候选清单里出现过的**，不要编造 id。',
].join('\n');

/**
 * 找出与新条目相似的已有条目
 * @param {{title:string, description:string, excludeId?:number, userId?:number}} p
 * @returns {Promise<Array<{id:number, title:string, score:number, reason:string, contact:string}>>}
 */
export async function findSimilarItems({ title = '', description = '', excludeId = 0, userId = 0 } = {}) {
  if (!(await getBool('ai.lf_match.enabled', false))) return [];
  if (!aiConfigured()) return [];

  // ★ 只在"候选可能相似"的前提下才值得花一次调用：候选池为空就直接返回
  const candidates = await query(
    `SELECT i.id, i.title, LEFT(i.description, ?) AS description, i.contact, i.publisher_id,
            i.created_at AS createdAt
       FROM lf_item i
      WHERE i.status = 1 AND i.id <> ?
      ORDER BY i.id DESC
      LIMIT ?`,
    [DESC_MAX, Number(excludeId) || 0, CANDIDATE_LIMIT],
  );
  if (!candidates.length) return [];

  const timeoutMs = Math.max(1000, await getInt('ai.lf_match.timeout_ms', 8000));
  const listText = candidates
    .map((c) => `  [${c.id}] ${c.title}｜${c.description || '（无描述）'}`)
    .join('\n');
  const user = [
    '【新发布的拾获物品】',
    `标题：${String(title).slice(0, 64)}`,
    `描述：${String(description).slice(0, 300)}`,
    '',
    '【已有条目候选】',
    listText,
    '',
    '请判断新物品与哪些条目可能是同一件东西。',
  ].join('\n');

  const t0 = Date.now();
  const raw = await aiJson({ system: SYSTEM, user, maxTokens: 400, temperature: 0, timeoutMs, totalBudgetMs: timeoutMs }).catch(() => null);
  await logAiUsage({
    userId,
    kind: 'lf_match',
    promptTokens: raw?._usage?.prompt_tokens ?? 0,
    completionTokens: raw?._usage?.completion_tokens ?? 0,
    ok: raw ? 1 : 0,
    costMs: Date.now() - t0,
  });
  if (!raw) return [];

  // ★ 服务端再校验一遍：id 必须真实存在、score 夹到 [0,1]、低于阈值丢弃
  const byId = new Map(candidates.map((c) => [Number(c.id), c]));
  const out = [];
  const seen = new Set();
  for (const m of Array.isArray(raw.matches) ? raw.matches.slice(0, 5) : []) {
    const id = Number(m?.id);
    const hit = byId.get(id);
    if (!hit || seen.has(id)) continue;
    let score = Number(m?.score);
    if (!Number.isFinite(score)) score = 0;
    score = Math.min(1, Math.max(0, score));
    if (score < MATCH_THRESHOLD) continue;
    seen.add(id);
    out.push({
      id,
      title: hit.title,
      contact: hit.contact,
      publisherId: Number(hit.publisher_id) || 0,
      score: Math.round(score * 100) / 100,
      reason: String(m?.reason || '').slice(0, 40),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}
