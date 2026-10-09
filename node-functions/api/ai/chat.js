// POST /api/ai/chat — C1 校园智能问答（面向全部登录账号）
//
// 协议：成功 → `text/event-stream`；失败 → 普通 JSON {code,message}
//   · 失败用 JSON 而不是 SSE，是为了让"根本没开始生成"的错误有一个干净的语义，
//     前端拿到后把 message 当作一条助手消息展示（不是错误 toast），业务照样跑得下去。
//   · SSE 事件序列：`meta`（出处/模式/版本）→ `delta`*（增量文本）→ `done`（usage）
//
// 知识注入见 docs/AI-FEATURES.md §5.1：L0 固定档案常驻 + L1 条目按阈值决定全量/召回。
// 铁律 #36：只用文本，不接收任何图片/音频字段。
import { preflight, fail, readBody } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { aiConfigured, aiModel, aiUpstream, logAiUsage } from '../../lib/ai.js';
import { getBool, getInt } from '../../lib/ai-config.js';
import { consumeAiQuota } from '../../lib/ai-guard.js';
import { KB_PROFILE, buildKnowledgeContext } from '../../lib/ai-kb.js';
import { variantOf } from '../../lib/ai-variant.js';
import { openAiToEvents, sseEvent, sseResponse } from '../../lib/sse.js';

export { preflight as onRequestOptions };

const MAX_QUESTION = 500; // 单次提问上限（chars）
const MAX_HISTORY = 6; // 携带的历史轮数上限（成本控制）
const MAX_HISTORY_CHARS = 400; // 单条历史消息截断长度

/** 回答纪律：只依据资料、不编造、简洁、不暴露内部编号 */
const SYSTEM_RULES = [
  '你是「智汇校园」一站式智慧校园服务平台的校园智能助手，服务对象是清北大学的师生。',
  '',
  '【回答纪律】（必须严格遵守）',
  '1. 只能依据下方【资料】回答。资料里没有的，直说"这个问题我暂时没有掌握，建议你到【公告中心】查看或联系辅导员"，绝不编造校规、时间、金额、电话、比例。',
  '2. 涉及平台功能与办事流程时，严格按资料描述，不要自行增减步骤或改换部门。',
  '3. 语气友好、简洁，像学长学姐答疑；控制在 250 字以内，能分点就分点。',
  '4. 不要输出「资料1」这类内部编号，也别说"根据资料"——直接给结论。',
  '5. 与清北大学校园学习生活无关的请求（写代码、聊时事、代写作业等）礼貌拒绝，并引导回校园话题。',
].join('\n');

/** 组装 messages：system(规则 + L0 档案 + L1 资料) + 历史 + 本次提问 */
function buildMessages(question, history, kbText) {
  const parts = [SYSTEM_RULES, '', '【平台基本档案】', KB_PROFILE];
  if (kbText) parts.push('', '【资料】', kbText);
  else parts.push('', '【资料】（本次没有检索到相关条目，请只依据上面的基本档案回答，并如实说明资料不足）');

  const messages = [{ role: 'system', content: parts.join('\n') }];
  for (const h of history) {
    const role = h?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(h?.content ?? '').trim().slice(0, MAX_HISTORY_CHARS);
    if (content) messages.push({ role, content });
  }
  messages.push({ role: 'user', content: question });
  return messages;
}

export async function onRequestPost(context) {
  const { roles, userId } = await requireRoles(context);

  // ---- 入参校验（先做，避免为无效请求消耗上游额度）----
  const body = await readBody(context.request, 8 * 1024);
  const question = String(body.question ?? '').trim();
  if (!question) return fail(49401, '请输入你要问的问题');
  if (question.length > MAX_QUESTION) return fail(49401, `问题太长了，请控制在 ${MAX_QUESTION} 字以内`);

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];

  // ---- 开关与配置（落库的运行时开关，改完 30 秒内生效，无需重新部署）----
  if (!aiConfigured()) return fail(49400, '智能问答暂未开通，请联系管理员', 503);
  if (!(await getBool('ai.enabled', true))) return fail(49430, '智能问答已被管理员暂时关闭', 503);
  if (!(await getBool('ai.chat.enabled', true))) return fail(49430, '智能问答已被管理员暂时关闭', 503);

  // ---- 频控（DB 流水计数，铁律 #23）----
  const quota = await consumeAiQuota(userId, 'chat');
  if (!quota.ok) return fail(49429, quota.message, 429);

  // ---- 知识注入 ----
  const inlineMaxChars = await getInt('ai.kb.inline_max_chars', 4000);
  const topK = await getInt('ai.kb.top_k', 5);
  const kb = await buildKnowledgeContext(question, { inlineMaxChars, topK });

  const messages = buildMessages(question, history, kb.text);

  // ---- 先拿到上游响应头再决定返回什么：失败时能干净地回 JSON ----
  const t0 = Date.now();
  const up = await aiUpstream({ messages, maxTokens: 800, temperature: 0.2, thinking: false });
  if (!up) {
    await logAiUsage({ userId, kind: 'chat', model: aiModel(), ok: 0, costMs: Date.now() - t0 });
    return fail(49430, '智能问答暂时不可用（AI 服务未响应），请稍后再试，或到【公告中心】查看通知', 503);
  }

  const variant = variantOf(roles);
  const meta = {
    variant,
    mode: kb.mode, // inline / retrieve / empty
    sources: kb.sources, // [{ id, title, category }]
    model: aiModel(),
  };

  const gen = openAiToEvents(up.response, {
    preamble: [sseEvent('meta', meta)],
    onDone: ({ content, usage }) =>
      logAiUsage({
        userId,
        kind: 'chat',
        model: aiModel(),
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        ok: content ? 1 : 0,
        costMs: up.costMs + (Date.now() - t0),
      }),
  });

  return sseResponse(gen);
}
