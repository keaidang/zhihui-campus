// node-functions/lib/ai-approval.js — C4 AI 审批助手（只建议，绝不自动审批）
//
// ★ 定位铁律（ADR-9）：**AI 只出建议，审批权始终在人**。
//   本模块没有任何写操作：不改 af_leave、不碰 flow_node，只读 + 生成建议。
//
// 输入是**服务端组装的事实**（不是用户输入）：本单信息 + 该生近 30 天请假次数与天数 +
//   请假时段内**有课冲突**的课程清单 + 是否明显超常。让模型基于事实说人话，
//   而不是让模型自己去"猜"风险点 —— 后者的结论不可复核、也无法在答辩时解释。
//
// 开关 ai.approval_advice.enabled（默认关）→ 关掉时返回 null，前端不显示卡片。
import { HttpError } from './guard.js';
import { query } from './db.js';
import { aiConfigured, aiJson, logAiUsage } from './ai.js';
import { getBool, getInt } from './ai-config.js';
import { dataScope } from './guard.js';
import { hasRole } from './services/_actor.js';

const SYSTEM = [
  '你是学校请假审批的**辅助分析**工具，为辅导员/管理员提供参考意见。',
  '',
  '【硬性要求】',
  '1. 只能基于下方【事实】分析，不得编造任何数字、课程名、日期。',
  '2. 你没有审批权，只是提建议；措辞要像给同事的一句话提醒，不要写成命令。',
  '3. 风险点必须**引用事实里的具体数据**（如"该生近 30 天已请假 3 次"）。',
  '4. 事实不足以判断时，suggestion 用 manual（建议人工核实），不要硬猜。',
  '',
  '【输出 JSON】',
  '{"suggestion":"approve|reject|manual","risk":["…"],"reason":"一句话建议理由","confidence":0.0}',
].join('\n');

/** 库内是 UTC 墙钟（铁律 #25）；这里换算成北京时区取星期，用于判断"请假期间是否有课" */
function beijingWeekday(s) {
  const d = new Date(`${String(s).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return 0;
  d.setTime(d.getTime() + 8 * 3600 * 1000);
  const w = d.getUTCDay(); // 0=周日
  return w === 0 ? 7 : w; // 转成 周一=1 … 周日=7
}

/** 请假区间内落在哪些星期（去重；最多扫 60 天，避免超长区间把循环拖大） */
function weekdaysInRange(startAt, endAt) {
  const s = new Date(`${String(startAt).replace(' ', 'T')}Z`);
  const e = new Date(`${String(endAt).replace(' ', 'T')}Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return [];
  const set = new Set();
  const cur = new Date(s);
  let guard = 0;
  while (cur <= e && guard < 60) {
    const bj = new Date(cur.getTime() + 8 * 3600 * 1000);
    const w = bj.getUTCDay();
    set.add(w === 0 ? 7 : w);
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return [...set].sort((a, b) => a - b);
}

/** 收集事实（可单测的部分在 weekdaysInRange） */
async function collectFacts(actor, leaveId) {
  const rows = await query(
    `SELECT l.id, l.student_id, l.dept_id, l.type, l.reason, l.start_at, l.end_at, l.status,
            u.real_name, u.user_no, u.class_id, d.name AS dept_name, cl.name AS class_name
       FROM af_leave l
       JOIN sys_user u ON u.id = l.student_id
       LEFT JOIN sys_department d ON d.id = l.dept_id
       LEFT JOIN sys_class cl ON cl.id = u.class_id
      WHERE l.id = ?`,
    [Number(leaveId)],
  );
  if (rows.length === 0) throw new HttpError(43004, '请假单不存在');
  const lv = rows[0];

  // 数据范围：辅导员只能看本院（与 lib/guard.js 同源，不另写一套）
  const scope = dataScope(actor.roles, actor.deptId);
  if (scope.type === 'dept' && Number(lv.dept_id) !== Number(scope.deptId)) {
    throw new HttpError(40301, '只能审批本院学生的申请', 403);
  }

  const [hist] = await query(
    `SELECT COUNT(*) AS times,
            COALESCE(ROUND(SUM(TIMESTAMPDIFF(HOUR, start_at, end_at)) / 24, 1), 0) AS days
       FROM af_leave
      WHERE student_id = ? AND created_at > NOW() - INTERVAL 30 DAY`,
    [lv.student_id],
  );

  const weekdays = weekdaysInRange(lv.start_at, lv.end_at);
  let conflicts = [];
  if (weekdays.length) {
    conflicts = await query(
      `SELECT c.name AS course, ec.week_day AS weekDay, ec.section, ec.classroom
         FROM edu_elect e
         JOIN edu_class ec ON ec.id = e.class_id
         JOIN edu_course c ON c.id = ec.course_id
        WHERE e.student_id = ? AND e.term = '2026-2027-1'
          AND ec.status = 1
          AND ec.week_day IN (${weekdays.map(() => '?').join(',')})
        ORDER BY ec.week_day, ec.section
        LIMIT 20`,
      [lv.student_id, ...weekdays],
    );
  }

  return { leave: lv, history: hist, weekdays, conflicts };
}

/** 事实 → 提示词文本（可读、可复核） */
function factsText({ leave, history, weekdays, conflicts }) {
  const days = Math.max(0, Math.round((new Date(`${String(leave.end_at).replace(' ', 'T')}Z`) - new Date(`${String(leave.start_at).replace(' ', 'T')}Z`)) / 86400000 * 10) / 10);
  return [
    `请假单号：${leave.id}`,
    `学生：${leave.real_name}（${leave.user_no || leave.student_id}）`,
    `院系/班级：${leave.dept_name || '-'} / ${leave.class_name || '-'}`,
    `类型：${leave.type}`,
    `事由：${leave.reason}`,
    `起止（UTC 墙钟）：${leave.start_at} ~ ${leave.end_at}（约 ${days} 天）`,
    `当前状态：${leave.status}（1 审批中 / 2 已批准 / 3 已驳回 / 4 已销假）`,
    '',
    `该生近 30 天请假：${history?.times ?? 0} 次，合计约 ${history?.days ?? 0} 天（含本条）`,
    `请假区间落在星期：${weekdays.length ? weekdays.map((w) => `周${'一二三四五六日'[w - 1]}`).join('、') : '（无法解析）'}`,
    conflicts.length
      ? `该时段内有课的教学班 ${conflicts.length} 个：\n${conflicts.map((c) => `  《${c.course}》周${'一二三四五六日'[c.weekDay - 1]} ${c.section} ${c.classroom || ''}`).join('\n')}`
      : '该时段内没有已选课程（或未选课）',
  ].join('\n');
}

/**
 * 生成审批建议
 * @returns {Promise<null|{suggestion:string, risk:string[], reason:string, confidence:number, facts:object, degraded?:boolean}>}
 *          `null` = 功能未开启（调用方不显示卡片）
 */
export async function adviseLeave(actor, leaveId, { userId = 0 } = {}) {
  if (!(await getBool('ai.approval_advice.enabled', false))) return null;

  const facts = await collectFacts(actor, leaveId);
  if (!aiConfigured()) {
    return { suggestion: 'manual', risk: [], reason: 'AI 未配置，请人工判断', confidence: 0, facts, degraded: true };
  }

  const timeoutMs = Math.max(1000, await getInt('ai.approval_advice.timeout_ms', 8000));
  const t0 = Date.now();
  const r = await aiJson({
    system: SYSTEM,
    user: `【事实】\n${factsText(facts)}\n\n请输出 JSON 建议。`,
    maxTokens: 400,
    temperature: 0.1,
    timeoutMs,
    totalBudgetMs: timeoutMs,
  });
  await logAiUsage({
    userId,
    kind: 'insight',
    ok: r ? 1 : 0,
    costMs: Date.now() - t0,
    promptTokens: r?._usage?.prompt_tokens ?? 0,
    completionTokens: r?._usage?.completion_tokens ?? 0,
  });

  if (!r) {
    return {
      suggestion: 'manual',
      risk: [],
      reason: 'AI 建议生成失败（超时或上游不可用），请人工判断',
      confidence: 0,
      facts,
      degraded: true,
    };
  }

  const sug = ['approve', 'reject', 'manual'].includes(String(r.suggestion)) ? String(r.suggestion) : 'manual';
  return {
    suggestion: sug,
    risk: Array.isArray(r.risk) ? r.risk.map((x) => String(x).slice(0, 120)).slice(0, 5) : [],
    reason: String(r.reason || '').slice(0, 300),
    confidence: Number.isFinite(Number(r.confidence)) ? Math.min(1, Math.max(0, Number(r.confidence))) : 0,
    facts,
  };
}

/** 是否可对某角色展示审批助手（前端据此决定要不要请求） */
export const canAdvise = (actor) => hasRole(actor, ['counselor', 'admin']);

export { weekdaysInRange, beijingWeekday };
