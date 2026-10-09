// GET /api/ai/eval — AI 效果评估结果（仅超管，只读）
//
// 为什么这里**只有 GET、没有"运行评估"按钮**：
//   一轮完整评估要调 30 次模型（triage 10 + review 12 + insight 8），按实测平均 3~4 秒/次，
//   是 90~120 秒 —— 远超边缘函数单次执行的时间预算。放在接口里跑必然顶到平台超时，
//   而平台超时后重试会撞上"请求体已被消费"（HANDOVER 铁律 #38），变成难查的 500。
//
//   所以：**跑分放脚本（scripts/ai-eval.mjs，本地跑无时间限制），页面只读结果**。
//   答辩现场演示时，看的是这份已经跑出来的真实报表 + 实时演示单条问数，
//   比"现场等两分钟"稳妥得多。
import { ok, jsonError, preflight } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { SCENES, caseStats, latestRuns } from '../../lib/ai-eval.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    await actorFrom(context, ['admin']);
    const [cases, runs] = await Promise.all([caseStats(), latestRuns()]);
    return ok({
      scenes: SCENES.map((s) => ({ key: s.key, label: s.label, desc: s.desc, need: s.need, costTokens: s.costTokens })),
      cases,
      runs,
    });
  } catch (e) {
    return jsonError(e);
  }
}
