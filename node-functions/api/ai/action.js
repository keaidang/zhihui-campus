// POST /api/ai/action — C5 管理员智能管理（对话式执行系统操作）
//
// 两阶段协议（ADR-9：破坏性操作必须二次确认）：
//   ① { text: "禁用账号 student01" }
//        → 只读操作：直接执行并返回 `{ intent, kind:'read', rows, summary }`
//        → 写操作  ：只解析 + 解析目标，返回 `{ intent, kind:'write', preview, confirmToken }`
//                    **此时一行数据都没改**
//   ② { confirmToken: "..." }
//        → 校验令牌（5 分钟、绑定操作者、重新解析目标）后执行，返回 `{ result:{message, affected, skipped} }`
//
// 安全边界（详见 lib/ai-actions.js 顶部注释）：
//   模型只做意图分类 + 参数抽取，**永不生成 SQL、永不直接执行**；动作必须在白名单内；
//   批量必须显式 all:true 且带范围；执行一律走 lib/services/*（与人工同一套权限与审计，标 via:ai）。
import { fail, jsonError, ok, preflight, readBody } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { aiConfigured, aiJson, aiModel, logAiUsage } from '../../lib/ai.js';
import { getBool } from '../../lib/ai-config.js';
import { consumeAiQuota } from '../../lib/ai-guard.js';
import { identityBlock, loadIdentity } from '../../lib/ai-identity.js';
import { KB_PROFILE, buildKnowledgeContext } from '../../lib/ai-kb.js';
import { buildAnswerSystem } from '../../lib/ai-prompt.js';
import { ACTIONS, actionCatalog, actionPromptFor, executeConfirmedAction, previewWriteAction, runReadAction } from '../../lib/ai-actions.js';

export { preflight as onRequestOptions };

const FINAL_JUDGE = [
  '【最终判定】先判断用户这句话是不是一条**系统管理指令**：',
  '- 是 → 输出 action（必须是上面列出的 key）+ params，reply 留空；**不要**替用户执行，也**不要**说"已执行"。',
  '- 不是（提问、闲聊、问制度流程、表述含糊）→ action 填 null，reply 里按上面的回答纪律正常回答用户的问题；',
  '  若用户意图是操作但信息不足，reply 里明确反问他缺什么（例如"要操作哪一个账号？"）。',
].join('\n');

const PARSE_RULES = [
  '你是「智汇校园」平台的**管理指令解析器**。你的唯一任务是把用户的一句话解析成结构化操作。',
  '',
  '【输出格式】严格输出 JSON，不要任何解释文字：',
  '{"action":"<下面列出的 key，或 null>","params":{...},"reply":"<仅当 action=null 时填写的一句话说明>"}',
  '',
  '【硬性规则】',
  '1. action 必须是下方列出的 key 之一；**不确定就填 null**，绝不编造 key。',
  '2. 只抽取用户**明确说出**的信息，不要脑补、不要补默认值。',
  '3. 用户说"全部/所有/所有XX"时，把 all 设为 true，并用 role 或 keyword 标明范围。',
  '4. 用户只是在提问、闲聊、问制度流程时，action 填 null，reply 里给出简短回答或提示。',
  '5. 用户的话有歧义（例如只说"处理一下那些"）时，action 填 null，reply 里反问澄清。',
].join('\n');

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context);
    // ★ 标记"这次操作来自 AI 对话"：服务层审计会在 detail 前缀 via:ai（铁律 #4），
    //   这样才能从 sys_op_log 里区分"人工点的按钮"和"AI 按指令执行的"（论文可统计）
    actor.viaAi = true;
    const body = await readBody(context.request, 8 * 1024);

    // ---- 第二阶段：带确认令牌执行 ----
    if (body.confirmToken) {
      const r = await executeConfirmedAction(actor, body.confirmToken);
      await logAiUsage({ userId: actor.userId, kind: 'action', model: aiModel(), ok: 1 });
      return ok({ intent: { action: r.action, label: r.label }, kind: 'write', result: r.result });
    }

    // ---- 第一阶段：解析意图 ----
    const text = String(body.text || '').trim();
    if (!text) return fail(49401, '请输入你的指令');
    if (text.length > 300) return fail(49401, '指令太长了，请控制在 300 字以内');

    const catalog = actionCatalog(actor);
    if (!catalog.length) return fail(49403, '你的角色没有可执行的系统操作权限', 403);

    if (!aiConfigured()) return fail(49400, '智能管理暂未开通，请联系管理员', 503);
    if (!(await getBool('ai.enabled', true))) return fail(49430, 'AI 功能已被管理员暂时关闭', 503);
    if (!(await getBool('ai.admin_console.enabled', true))) return fail(49430, 'AI 智能管理已被管理员关闭', 503);

    const quota = await consumeAiQuota(actor.userId, 'action');
    if (!quota.ok) return fail(49429, quota.message, 429);

    const identity = await loadIdentity(actor.userId);

    // ★ 单次调用同时支持"执行指令"与"回答问题"：
    //   解析不出 action 时，用**同一份知识库与回答纪律**直接把问题答掉 ——
    //   否则管理员问一句普通问题要付两次费（先解析、再问答），且要等两轮。
    const kb = await buildKnowledgeContext(text, {
      inlineMaxChars: 4000,
      topK: 5,
      minScore: 3,
      minRatio: 0.25,
    });

    const system = buildAnswerSystem({
      identityText: identityBlock(identity, actor.roles),
      kbProfile: KB_PROFILE,
      kbText: kb.text,
      extraTop: [PARSE_RULES, '', '【可用操作】', actionPromptFor(actor), '', FINAL_JUDGE].join('\n'),
    });

    const t0 = Date.now();
    // 总预算 9s（含重试）：留足余量给平台，避免顶到函数超时后触发平台重试（见 lib/ai.js 注释）
    const parsed = await aiJson({ system, user: text, maxTokens: 400, temperature: 0, timeoutMs: 8000, totalBudgetMs: 9000 });
    if (!parsed) {
      await logAiUsage({ userId: actor.userId, kind: 'action', model: aiModel(), ok: 0, costMs: Date.now() - t0 });
      return fail(49430, '指令解析服务暂时不可用，请稍后再试（你也可以直接在页面上操作）', 503);
    }
    await logAiUsage({
      userId: actor.userId,
      kind: 'action',
      model: aiModel(),
      promptTokens: parsed._usage?.prompt_tokens ?? 0,
      completionTokens: parsed._usage?.completion_tokens ?? 0,
      ok: 1,
      costMs: Date.now() - t0,
    });

    const key = parsed.action === null || parsed.action === undefined ? null : String(parsed.action);
    const params = parsed.params && typeof parsed.params === 'object' ? parsed.params : {};

    // 模型说"这不是一个操作" → 交给前端当普通回答展示
    if (!key || !ACTIONS[key]) {
      return ok({
        intent: { action: null },
        kind: 'none',
        reply: String(parsed.reply || '我没理解这是一条系统管理指令。你可以说得更具体些，例如"禁用账号 student01"或"查看所有待审批的请假"。').slice(0, 800),
        sources: kb.sources || [],
      });
    }

    const def = ACTIONS[key];
    if (def.kind === 'read') {
      const r = await runReadAction(actor, key, params);
      return ok({ intent: { action: key, label: def.label }, kind: 'read', rows: r.rows || [], summary: r.summary || '' });
    }

    // 写操作：只预览，不执行
    const p = await previewWriteAction(actor, key, params);
    return ok({ intent: { action: p.action, label: p.label }, kind: 'write', preview: p.preview, confirmToken: p.confirmToken });
  } catch (e) {
    return jsonError(e);
  }
}
