// node-functions/lib/ai-triage.js — C8 报修智能分诊
//
// 定位（docs/AI-FEATURES.md §8.2）：学生提交报修时，判定
//   { urgency 紧急度, dept 责任部门, selfService 是否可能自行解决, suggestion 给学生的下一步 }
//   结果写入 `af_repair.ai_triage`，后勤在工单列表就能看到该派给谁、急不急。
//
// ★ 三条设计纪律：
//   ① **绝不阻塞报修**：超时（默认 3s）或失败 → 返回 null，工单照常创建。
//      报修是学生报故障的通道，任何情况下都不能因为"AI 没空"而让学生报不上修。
//   ② **部门是白名单枚举**：模型只能从固定列表里选，不能自由生成"XX 维修队"这种查无此处的部门。
//   ③ **不写库到 AI 之外的地方**：本模块只产出判定结果，落库由 handler 显式执行（便于审计与开关）。
//
// 铁律 #36：纯文本判定，不读图片、不传多模态字段。
import { aiConfigured, aiJson, logAiUsage } from './ai.js';
import { getBool, getInt } from './ai-config.js';

/** 责任部门（必须与学校实际部门对应；模型只能从这里选） */
export const TRIAGE_DEPTS = ['后勤处水电组', '后勤处维修组', '网络信息中心', '保卫处', '学工处', '其他'];

/** 紧急度（urgent 会建议立即处理；low 属于可延后的小问题） */
export const TRIAGE_URGENCY = ['low', 'normal', 'high', 'urgent'];

const URGENCY_LABEL = { low: '不急', normal: '一般', high: '较急', urgent: '紧急' };

const SYSTEM = [
  '你是「智汇校园」宿舍报修工单的分诊助手。学生提交报修后，你判断三件事：',
  '',
  '1. urgency：紧急度',
  '   - urgent：漏水/停电/冒火/煤气/被困（门锁打不开人出不去）等有安全风险或影响基本生活的情况',
  '   - high：无法正常学习生活（没热水、网络完全不通、马桶堵塞、床板断裂）',
  '   - normal：影响使用但能凑合（灯管闪、水龙头滴水、柜门松动）',
  '   - low：不影响使用的轻微问题（墙面小裂、开关外壳松、椅子有点响）',
  '',
  `2. dept：责任部门，**只能从这里选**：${TRIAGE_DEPTS.join('、')}`,
  '   - 水电（灯、插座、漏水、热水器、水管）→ 后勤处水电组',
  '   - 家具/门窗/床铺/柜子/墙面 → 后勤处维修组',
  '   - 校园网、WiFi、网口、网线 → 网络信息中心',
  '   - 宿舍安全相关（陌生人闯入、门锁被撬、消防隐患）→ 保卫处',
  '   - 涉及室友矛盾、宿舍调换申请 → 学工处',
  '   - 实在判断不出 → 其他',
  '',
  '3. selfService：学生**有可能自己先处理**（true/false）与一句建议',
  '   - true 的例子：跳闸（可先看配电箱合闸）、插座被总开关关闭、网线没插紧、空调遥控器没电',
  '   - 注意：selfService=true 只是"可以先试一下"，**不代表不让工人上门**，',
  '     也不要把有安全风险的事（漏电、冒烟、漏水到楼下）判为可自理',
  '',
  '【输出】严格输出 JSON，不要任何解释文字：',
  '{"urgency":"low|normal|high|urgent","dept":"<上面列出的部门>","selfService":true|false,"suggestion":"给学生的一句话（30字内，说明先做什么或等谁上门）"}',
  '',
  '宁松勿紧：判断不出就选 normal / 其他 / false，不要为了显得聪明而瞎猜。',
].join('\n');

/** 规范化模型输出：非法值一律降级为保守值（绝不因为模型乱答而把紧急工单降级） */
export function normalizeTriage(obj) {
  const u = String(obj?.urgency || '').toLowerCase().trim();
  const urgency = TRIAGE_URGENCY.includes(u) ? u : 'normal';
  const dept = TRIAGE_DEPTS.includes(String(obj?.dept || '').trim()) ? String(obj.dept).trim() : '其他';
  const selfService = obj?.selfService === true;
  return {
    urgency,
    urgencyLabel: URGENCY_LABEL[urgency],
    dept,
    selfService,
    suggestion: String(obj?.suggestion || '').slice(0, 60),
  };
}

/**
 * 分诊判定
 * @returns {Promise<object|null>} null = 未开启/未配置/超时（调用方直接跳过，工单照常创建）
 */
export async function triageRepair({ description = '', location = '', category = '' } = {}) {
  if (!(await getBool('ai.triage.enabled', false))) return null;
  if (!aiConfigured()) return null;
  if (!String(description).trim()) return null;

  const timeoutMs = Math.max(800, await getInt('ai.triage.timeout_ms', 3000));
  const user = [
    location ? `报修位置：${String(location).slice(0, 128)}` : '',
    category ? `学生自选分类：${String(category).slice(0, 32)}` : '',
    `故障描述：${String(description).slice(0, 500)}`,
    '',
    '请分诊。',
  ]
    .filter(Boolean)
    .join('\n');

  const t0 = Date.now();
  // 硬上限：aiJson 内部失败会重试一次，这里再竞速兜死，保证提交报修不会被分诊拖住
  let timedOut = false;
  const timer = new Promise((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, timeoutMs);
  });
  const raw = await Promise.race([
    aiJson({ system: SYSTEM, user, maxTokens: 200, temperature: 0, timeoutMs, totalBudgetMs: timeoutMs }).catch(() => null),
    timer,
  ]);

  if (!raw) {
    await logAiUsage({ userId: 0, kind: 'triage', ok: 0, costMs: Date.now() - t0 });
    return {
      urgency: 'normal',
      urgencyLabel: URGENCY_LABEL.normal,
      dept: '其他',
      selfService: false,
      suggestion: '',
      degraded: true,
      reason: timedOut ? 'AI 分诊超时' : 'AI 分诊未返回',
    };
  }

  await logAiUsage({
    userId: 0,
    kind: 'triage',
    promptTokens: raw._usage?.prompt_tokens ?? 0,
    completionTokens: raw._usage?.completion_tokens ?? 0,
    ok: 1,
    costMs: Date.now() - t0,
  });
  return { ...normalizeTriage(raw), degraded: false };
}

/** 落 `af_repair.ai_triage` 的文本形式（人可读，顺带可 grep） */
export function formatTriage(t) {
  if (!t) return '';
  const s = `[${t.urgencyLabel || t.urgency}] → ${t.dept}${t.selfService ? '（学生可先自行尝试）' : ''}${t.suggestion ? ` · ${t.suggestion}` : ''}`;
  return s.slice(0, 500);
}

/** 解析 `ai_triage` 文本（前端展示用；解析不出来就原样返回） */
export function parseTriage(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const m = /^\[([^\]]+)\]\s*→\s*([^（(·]+)(（学生可先自行尝试）)?(?:\s*·\s*(.+))?$/.exec(str);
  if (!m) return { raw: str };
  return { urgencyLabel: m[1], dept: m[2].trim(), selfService: Boolean(m[3]), suggestion: (m[4] || '').trim(), raw: str };
}
