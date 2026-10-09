// /api/ai/study — C7 学生学业助手
//
// GET  → 学业概览（已获学分 / 绩点 / 挂科 / 本学期课表），不耗 AI token，前端直接渲染卡片
// POST → 流式问答（`text/event-stream`，与 /api/ai/chat 同协议）
//
// 权限：仅 student（含"同时具备 student 角色"的多角色账号——累加式分级，见 AI-FEATURES §1.4）
// 数据：所有 SQL 硬编码 `student_id = 当前登录用户`，请求体里**没有** studentId 这个字段
// 铁律 #36：纯文本，不接收图片/音频
import { preflight, fail, readBody, jsonError, ok } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { aiConfigured, aiModel, aiUpstream, logAiUsage } from '../../lib/ai.js';
import { getBool } from '../../lib/ai-config.js';
import { consumeAiQuota, releaseAiQuota } from '../../lib/ai-guard.js';
import { buildOverview, buildStudyMessages, buildStudySystem, loadStudyRows, STUDY_TOPICS } from '../../lib/ai-study.js';
import { sseEvent, sseResponse, openAiToEvents } from '../../lib/sse.js';

export { preflight as onRequestOptions };

const MAX_QUESTION = 300;
const MAX_HISTORY = 6;

export async function onRequestGet(context) {
  try {
    const { userId } = await requireRoles(context, ['student']);
    if (!aiConfigured()) return fail(49400, '学业助手暂未开通，请联系管理员', 503);
    if (!(await getBool('ai.enabled', true))) return fail(49430, '学业助手已被管理员暂时关闭', 503);
    if (!(await getBool('ai.study.enabled', true))) return fail(49430, '学业助手已被管理员暂时关闭', 503);

    const rows = await loadStudyRows(userId);
    return ok({ overview: buildOverview(rows), topics: STUDY_TOPICS });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  // 统一错误包装（铁律 #37）：只包"开始生成之前"的部分；
  // SSE 已发出后的异常由 openAiToEvents 转成 error 事件
  // ★ held：是否已占用一次在途额度（供 finally 释放）。见 lib/ai-guard.js 的"在途标记"说明。
  let held = 0;
  try {
    const { roles, userId } = await requireRoles(context, ['student']);

    const body = await readBody(context.request, 8 * 1024);
    const question = String(body.question ?? '').trim();
    if (!question) return fail(49401, '请输入你想问的学业问题');
    if (question.length > MAX_QUESTION) return fail(49401, `问题太长了，请控制在 ${MAX_QUESTION} 字以内`);
    const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];

    if (!aiConfigured()) return fail(49400, '学业助手暂未开通，请联系管理员', 503);
    if (!(await getBool('ai.enabled', true))) return fail(49430, '学业助手已被管理员暂时关闭', 503);
    if (!(await getBool('ai.study.enabled', true))) return fail(49430, '学业助手已被管理员暂时关闭', 503);

    const quota = await consumeAiQuota(userId, 'chat');
    if (!quota.ok) return fail(49429, quota.message, 429);
    held = userId;

    // 学业事实由服务端算好（口径同成绩页面），模型只做表述
    const { system, overview, sources } = await buildStudySystem({ userId, roles }, question);
    const messages = buildStudyMessages(system, question, history);

    const t0 = Date.now();
    const up = await aiUpstream({ messages, maxTokens: 700, temperature: 0.2, thinking: false });
    if (!up) {
      await logAiUsage({ userId, kind: 'study', model: aiModel(), ok: 0, costMs: Date.now() - t0 });
      return fail(49430, '学业助手暂时不可用（AI 服务未响应），请稍后再试', 503);
    }

    const gen = openAiToEvents(up.response, {
      preamble: [
        sseEvent('meta', {
          kind: 'study',
          model: aiModel(),
          sources,
          overview: {
            creditsEarned: overview.creditsEarned,
            gpa: overview.gpa,
            failedCount: overview.failedCount,
            inProgressCount: overview.inProgressCount,
          },
        }),
      ],
      onDone: ({ content, usage }) =>
        logAiUsage({
          userId,
          kind: 'study',
          model: aiModel(),
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
          ok: content ? 1 : 0,
          costMs: up.costMs + (Date.now() - t0),
        }),
    });

    return sseResponse(gen);
  } catch (e) {
    return jsonError(e);
  } finally {
    // ★ 释放在途标记（流式接口在此释放的时机是"上游握手完成、响应已交回平台"）
    if (held) releaseAiQuota(held);
  }
}
