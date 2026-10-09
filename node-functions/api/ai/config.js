// /api/ai/config — AI 运行时开关（仅超管）
//
// GET  一次性返回全部 `ai.*` 配置 + 该键的说明 + 当前生效值
// POST { key, value } 更新单个开关（落 opLog）
//
// 为什么必须有这个接口（AI-FEATURES §2.2）：环境变量改一次要重新部署（铁律 #5），
// 而"管理员在页面上开关 AI 功能"必须即时生效 —— 所以开关落 `sys_config`。
// 本接口是管理员**唯一**触碰这些开关的入口（`setConfig` 内部拒改非 ai.* 键）。
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { allConfig, setConfig } from '../../lib/ai-config.js';
import { aiConfigured, aiMeta } from '../../lib/ai.js';
import { usageSummary } from '../../lib/ai-guard.js';

export { preflight as onRequestOptions };

/**
 * 开关的中文说明 + **显式类型**（与 schema-012 的 remark 同源；此处冗余一份用于接口自描述）
 *
 * ★ 类型必须显式声明，不能从值去猜：布尔开关的值就是 '0'/'1'，用 `^\d+$` 判会全部被当成数字，
 *   于是控制台把"论坛审核开关"渲染成"修改"按钮而不是开关 —— 2026-10-09 线上验收暴露。
 */
export const LABELS = {
  'ai.enabled': { label: 'AI 总开关（关闭 = 全站 AI 静默降级）', type: 'bool' },
  'ai.chat.enabled': { label: 'C1 校园智能问答', type: 'bool' },
  'ai.chat.rate_per_min': { label: '每用户每分钟问答次数上限', type: 'number' },
  'ai.chat.daily_per_user': { label: '每用户每日问答次数上限', type: 'number' },
  'ai.forum_review.enabled': { label: 'C2 论坛 AI 审核员（默认关）', type: 'bool' },
  'ai.forum_review.block_on_violation': { label: 'C2 判定违规时直接拦截发帖', type: 'bool' },
  'ai.forum_review.timeout_ms': { label: 'C2 审核超时（超时 = 放行并标记待复核）', type: 'number' },
  'ai.alert.enabled': { label: 'C3 异常告警邮件总开关（默认关）', type: 'bool' },
  'ai.alert.emails': { label: 'C3 收件人（逗号分隔；留空则取 admin 角色的校园邮箱）', type: 'text' },
  'ai.alert.dedupe_min': { label: 'C3 同类告警去重窗口（分钟）', type: 'number' },
  'ai.approval_advice.enabled': { label: 'C4 AI 审批助手（只建议，不自动审批；默认关）', type: 'bool' },
  'ai.approval_advice.timeout_ms': { label: 'C4 建议生成超时', type: 'number' },
  'ai.admin_console.enabled': { label: 'C5 对话式系统管理', type: 'bool' },
  'ai.insight.enabled': { label: 'C6 信息问数', type: 'bool' },
  'ai.study.enabled': { label: 'C7 学生学业助手', type: 'bool' },
  'ai.triage.enabled': { label: 'C8 报修智能分诊（默认关）', type: 'bool' },
  'ai.notice_summary.enabled': { label: 'C9 公告 AI 摘要（默认关）', type: 'bool' },
  'ai.lf_match.enabled': { label: 'C10 失物招领智能匹配（默认关）', type: 'bool' },
  'ai.anomaly.enabled': { label: 'C11 数据异常监测（默认关）', type: 'bool' },
  'ai.lib_search.enabled': { label: 'C12 图书自然语言检索', type: 'bool' },
  'ai.kb.inline_max_chars': { label: '知识库全量注入阈值', type: 'number' },
  'ai.kb.top_k': { label: '知识库召回条数', type: 'number' },
};

export async function onRequestGet(context) {
  try {
    await actorFrom(context, ['admin']);
    const map = await allConfig();
    const items = Object.entries(map)
      .filter(([k]) => k.startsWith('ai.'))
      .map(([key, value]) => ({
        key,
        value,
        label: LABELS[key]?.label || '',
        type: LABELS[key]?.type || 'text',
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const usage = await usageSummary(7);
    return ok({ ...aiMeta(), items, usage });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context, ['admin']);
    if (!aiConfigured()) return fail(49400, 'AI 未配置密钥，开关暂不可用', 503);
    const body = await readBody(context.request);
    const key = String(body.key || '').trim();
    if (!key.startsWith('ai.')) return fail(49401, '仅允许修改 ai.* 配置');
    if (!Object.prototype.hasOwnProperty.call(LABELS, key)) return fail(49401, '未知的配置项');

    // 开关型只允许 0/1；数值型必须是合法整数；文本型限长
    let value = body.value;
    const type = LABELS[key].type;
    if (type === 'bool') value = Number(value) === 1 || value === true || value === '1' ? '1' : '0';
    else if (type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return fail(49401, '该项必须是大于等于 0 的数字');
      value = String(Math.trunc(n));
    } else value = String(value ?? '').slice(0, 512);

    const r = await setConfig(key, value, actor.userId, actor.ip);
    return ok(r, `已更新（约 30 秒内在全部实例生效）`);
  } catch (e) {
    return jsonError(e);
  }
}
