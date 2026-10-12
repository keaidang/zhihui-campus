// POST /api/ai/mail-compose — C15 智能邮件助理 · 校园公文与请假润色
//
// 作用：为师生在写信/公文场景提供一键起草与语言润色能力（学术请教、请假报备、通知公告、社团招新等）。
// 铁律 #36：纯文本输入输出，不接收任何多模态字段。
// 铁律 #23：频控走 DB 流水。
import { preflight, fail, ok, readBody, jsonError } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { aiConfigured, aiJson, aiModel, logAiUsage } from '../../lib/ai.js';
import { getBool } from '../../lib/ai-config.js';
import { consumeAiQuota, releaseAiQuota } from '../../lib/ai-guard.js';
import { loadIdentity } from '../../lib/ai-identity.js';

export { preflight as onRequestOptions };

const MAX_PROMPT = 800;
const MAX_ORIGINAL = 2000;

const SCENARIO_NAMES = {
  leave: '请假报备与离校申请',
  academic: '学术请教与导师沟通',
  notice: '行政事务与通知公告',
  club: '社团活动与招募联络',
  general: '通用师生日常邮件',
};

const TONE_NAMES = {
  polite: '诚恳谦逊、礼貌周到',
  formal: '严谨规范、官方公文风格',
  concise: '简洁利落、突出重点',
  friendly: '热情亲和、生动得体',
};

export async function onRequestPost(context) {
  let held = 0;
  const t0 = Date.now();
  try {
    const { userId } = await requireRoles(context);

    const body = await readBody(context.request, 16 * 1024);
    const prompt = String(body.prompt ?? '').trim();
    const originalText = String(body.originalText ?? '').trim();
    const scenario = String(body.scenario ?? 'general').trim();
    const tone = String(body.tone ?? 'polite').trim();

    if (!prompt && !originalText) {
      return fail(49401, '请提供起草要求或需要润色的原正文');
    }
    if (prompt.length > MAX_PROMPT) {
      return fail(49401, `起草要求过长，请控制在 ${MAX_PROMPT} 字以内`);
    }
    if (originalText.length > MAX_ORIGINAL) {
      return fail(49401, `原始正文过长，请控制在 ${MAX_ORIGINAL} 字以内`);
    }

    if (!aiConfigured()) return fail(49400, '智能邮件助理暂未开通，请联系管理员', 503);
    if (!(await getBool('ai.enabled', true))) return fail(49430, 'AI 服务已被管理员暂时关闭', 503);

    const quota = await consumeAiQuota(userId, 'chat');
    if (!quota.ok) return fail(49429, quota.message, 429);
    held = userId;

    const identity = await loadIdentity(userId);
    const senderRoleDesc = identity?.realName
      ? `${identity.realName}（${identity.deptName || '智慧校园成员'}，学工号 ${identity.username || ''}）`
      : '智慧校园用户';

    const scenarioDesc = SCENARIO_NAMES[scenario] || SCENARIO_NAMES.general;
    const toneDesc = TONE_NAMES[tone] || TONE_NAMES.polite;

    const systemPrompt = [
      '你是一位高校数字校园智能公文与邮件助理。',
      '请根据用户的意图或原始草稿，为发件人生成格式规范、得体专业的校园邮件（主题与正文）。',
      `发件人身份参考：${senderRoleDesc}`,
      `邮件应用场景：${scenarioDesc}`,
      `语言风格要求：${toneDesc}`,
      '',
      '【写作纪律】',
      '1. 主题（subject）：简明扼要，包含核心事项与发件人姓名/学工号关键信息，控制在 25 字以内，如「关于张三（学号2024001）本周五请假就医的申请」。',
      '2. 正文（body）：包含恰当的称谓（如尊敬的XX老师/各位同学）、正文阐述清晰、段落分明、礼貌致谢、标准书信结语及署名落款。',
      '3. 如用户提供了原始文本，请在保留其真实事实的前提下予以润色修正（错别字、语病、排版与礼貌用语规范）。',
      '4. 严禁捏造虚构事实，严禁生成任何违规违法言论。',
      '5. 必须返回纯 JSON 格式：{"subject": "...", "body": "..."}',
    ].join('\n');

    const userPrompt = [
      prompt ? `【起草诉求】：${prompt}` : '',
      originalText ? `【原始正文草稿】：\n${originalText}` : '',
    ].filter(Boolean).join('\n\n');

    const parsed = await aiJson({
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 750,
      timeoutMs: 15000,
    });

    if (!parsed || !parsed.subject || !parsed.body) {
      await logAiUsage({ userId, kind: 'mail_compose', model: aiModel(), ok: 0, costMs: Date.now() - t0 });
      return fail(49430, '生成邮件草稿失败，请稍后重试', 503);
    }

    await logAiUsage({
      userId,
      kind: 'mail_compose',
      model: aiModel(),
      ok: 1,
      costMs: Date.now() - t0,
    });

    return ok({
      subject: String(parsed.subject || '').trim(),
      body: String(parsed.body || '').trim(),
    });
  } catch (e) {
    return jsonError(e);
  } finally {
    if (held) releaseAiQuota(held);
  }
}
