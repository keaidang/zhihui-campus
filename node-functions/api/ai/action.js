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
import { canInsight, entityPromptSections, insightPromptFor, runInsight } from '../../lib/ai-insight.js';
import { runStructuredQuery } from '../../lib/ai-query.js';

export { preflight as onRequestOptions };

const FINAL_JUDGE = [
  '【最终判定】按顺序判断用户的意图属于哪一类：',
  '1. 要**改动数据**（禁用账号、批准请假、发公告…）→ 输出 action + params，其余留空；',
  '   **不要**替用户执行，也**不要**说"已执行"。',
  '2. 要**看统计数据**（哪个班请假最多、各院系排名、入住率…）→ 输出 insight + insightParams，其余留空。',
  '3. 要**自由组合统计**（总数、按某维度分组排名、按某指标取最差/最优）→ 输出 query + query。',
  '   ⚠ **优先级最低**：能用 insight 模板回答的，优先用 insight；模板覆盖不到的才用 query。',
  '4. 其余（提问、闲聊、问制度流程、表述含糊）→ action / insight / query 全部填 null，',
  '   reply 里按上面的回答纪律正常回答；若意图是操作但信息不足，明确反问他缺什么。',
].join('\n');

const PARSE_RULES = [
  '你是「智汇校园」平台的**管理指令解析器**。你的唯一任务是把用户的一句话解析成结构化操作。',
  '',
  '【输出格式】严格输出 JSON，不要任何解释文字：',
  '{"action":"<操作 key 或 null>","params":{...},"insight":"<问数模板 key 或 null>","insightParams":{...},"query":<对象或 null>,"reply":"<三者都为 null 时的一句话说明>"}',
  '',
  '【硬性规则】',
  '1. action / insight / query **最多只能有一个非 null**（改数据、查模板、自由统计，三选一，别同时给）。',
  '2. action / insight 都必须是下方列出的 key 之一；**不确定就填 null**，绝不编造 key。',
  '3. 只抽取用户**明确说出**的信息，不要脑补、不要补默认值；枚举值只能取括号里列出的值。',
  '4. 用户说"全部/所有/所有XX"时，把 all 设为 true，并用 role 或 keyword 标明范围。',
  '5. 用户只是在提问、闲聊、问制度流程时，两个都填 null，reply 里给出简短回答或提示。',
  '6. 用户的话有歧义（例如只说"处理一下那些"）时，两个都填 null，reply 里反问澄清。',
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
      extraTop: [
        PARSE_RULES,
        '',
        '【可用操作】',
        actionPromptFor(actor),
        '',
        ...(canInsight(actor) ? ['【可用问数模板】（用户要统计数字时优先用这个，不要用 action）', insightPromptFor(actor), ''] : []),
        ...entityPromptSections(actor),
        FINAL_JUDGE,
      ].join('\n'),
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

    // ---- 问数分支（C6）：一个调用同时支持"执行/问数/问答"，避免管理员多付一次费 ----
    const insKey = parsed.insight == null ? null : String(parsed.insight);
    if (!key || !ACTIONS[key]) {
      if (insKey && canInsight(actor)) {
        try {
          const r = await runInsight(actor, insKey, parsed.insightParams && typeof parsed.insightParams === 'object' ? parsed.insightParams : {});
          return ok({
            intent: { template: r.template, label: r.label },
            kind: 'data',
            params: r.params,
            periodLabel: r.periodLabel,
            rows: r.rows,
            extra: r.extra,
            summary: r.summary,
          });
        } catch (e) {
          // 参数不合法/模板不存在 → 不报错，退化成"回答"分支（下面的 reply）
          if (e?.code === 49402 && !parsed.reply) {
            return ok({
              intent: { template: null },
              kind: 'none',
              reply: `没能识别要查什么数据（${e.message}）。可以试试"近 7 天哪个班请假最多""各院系请假天数排名"。`,
              sources: kb.sources || [],
            });
          }
          if (e?.code !== 49402) throw e;
        }
      }
    }

    // ---- 通用结构化查询分支（C13）：模板覆盖不到的统计走这里 ----
    // 放在 insight 之后：模板表达力更强（多表联查）且已验证，能用模板就优先用。
    // ★ 角色无权时**不静默跳过**而是直接回错：那说明是权限问题，告知模型才能改口，
    //   静默跳过会让它误以为"没有这个能力"，反复换措辞重试浪费轮次。
    if ((!key || !ACTIONS[key]) && !insKey) {
      const q = parsed.query;
      if (q && typeof q === 'object' && !Array.isArray(q)) {
        const r = await runStructuredQuery(actor, q, { wanted: Number(parsed.limit) || undefined });
        return ok({
          intent: { entity: r.entity, label: `${r.entityLabel}统计` },
          kind: 'data',
          viaQuery: true,
          isAggregate: r.isAggregate,
          scalar: r.scalar,
          rows: r.rows,
          summary: r.summary,
          metrics: r.metrics,
          groupBy: r.groupBy,
        });
      }
    }

    // 模型说"这不是一个操作" → 交给前端当普通回答展示
    if (!key || !ACTIONS[key]) {
      return ok({
        intent: { action: null },
        kind: 'none',
        reply: String(parsed.reply || '我没理解这是要做什么。可以更具体些，例如"禁用账号 student01""查看所有待审批的请假""学生账号总数""绩点最差的学生"。').slice(0, 800),
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
