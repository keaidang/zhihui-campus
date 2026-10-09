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

/** 开关的中文说明（与 schema-012 的 remark 同源；此处冗余一份用于接口自描述） */
const LABELS = {
  'ai.enabled': 'AI 总开关（关闭 = 全站 AI 静默降级）',
  'ai.chat.enabled': 'C1 校园智能问答',
  'ai.chat.rate_per_min': '每用户每分钟问答次数上限',
  'ai.chat.daily_per_user': '每用户每日问答次数上限',
  'ai.forum_review.enabled': 'C2 论坛 AI 审核员（默认关）',
  'ai.forum_review.block_on_violation': 'C2 判定违规时直接拦截发帖',
  'ai.forum_review.timeout_ms': 'C2 审核超时（超时 = 放行并标记待复核）',
  'ai.alert.enabled': 'C3 异常告警邮件总开关（默认关）',
  'ai.alert.emails': 'C3 收件人（逗号分隔；留空则取 admin 角色的校园邮箱）',
  'ai.alert.dedupe_min': 'C3 同类告警去重窗口（分钟）',
  'ai.approval_advice.enabled': 'C4 AI 审批助手（只建议，不自动审批；默认关）',
  'ai.approval_advice.timeout_ms': 'C4 建议生成超时',
  'ai.admin_console.enabled': 'C5 对话式系统管理',
  'ai.insight.enabled': 'C6 信息问数',
  'ai.study.enabled': 'C7 学生学业助手',
  'ai.triage.enabled': 'C8 报修智能分诊（默认关）',
  'ai.notice_summary.enabled': 'C9 公告 AI 摘要（默认关）',
  'ai.lf_match.enabled': 'C10 失物招领智能匹配（默认关）',
  'ai.anomaly.enabled': 'C11 数据异常监测（默认关）',
  'ai.lib_search.enabled': 'C12 图书自然语言检索',
  'ai.kb.inline_max_chars': '知识库全量注入阈值',
  'ai.kb.top_k': '知识库召回条数',
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
        label: LABELS[key] || '',
        type: /^\d+$/.test(value) ? 'number' : key.endsWith('.emails') ? 'text' : 'bool',
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
    const type = /^\d+$/.test(String((await allConfig())[key] ?? '')) ? 'number' : key.endsWith('.emails') ? 'text' : 'bool';
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
