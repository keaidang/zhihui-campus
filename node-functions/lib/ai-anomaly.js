// node-functions/lib/ai-anomaly.js — C11 数据异常监测
//
// 定位（docs/AI-FEATURES.md §8.5）：定期/手动扫描业务数据里的**异常信号**，邮件推送给管理员。
//
// ★ 本模块的成本与可靠性设计（重要，答辩可讲）：
//   检测**全部用 SQL 规则**完成，**不使用模型**——异常监测是"每天都要跑"的任务，
//   若每次都调模型，既贵又不可复现（同一个数据集两次结论可能不同，无法追责）。
//   规则检测的结果是确定的、可解释的、可加单测的。
//   AI 只在这之后做**一件事**：把 findings 汇总成一段人话摘要（1 次调用，可关）。
//   —— 这就是"该用规则的地方不用模型，该用模型的地方不用规则"。
//
// 另外：findings 为空时**不发邮件**（避免每天一封"一切正常"制造告警疲劳）。
import { query } from './db.js';
import { aiConfigured, aiChat, logAiUsage } from './ai.js';
import { getBool } from './ai-config.js';
import { alert } from './alert.js';

/** 阈值集中在此，便于调参与写文档 */
export const THRESHOLDS = {
  leaveWindowDays: 30, // 请假异常观察窗口
  leaveMinStudents: 3, // 至少这么多人才谈得上"集中"
  leaveRatio: 0.5, // 涉及人数 / 班级人数 ≥ 该比例算畸高
  overdueMin: 5, // 逾期图书至少这么多本才提示
  reviewBacklogHours: 24, // 待复核积压超过该小时数提示
};

const WD = (v) => Number(v) || 0;

/**
 * 运行全部检测（纯 SQL，零模型成本）
 * @param {{days?:number}} [opts]
 * @returns {Promise<Array<{key:string, level:'high'|'mid', title:string, detail:string, count:number}>>}
 */
export async function runChecks({ days = THRESHOLDS.leaveWindowDays } = {}) {
  const findings = [];

  // ---- ① 请假集中：某班请假涉及人数占比畸高 ----
  const leaveRows = await query(
    `SELECT COALESCE(cl.name, '（未分班）') AS className,
            COALESCE(d.name, '-') AS deptName,
            COUNT(*) AS times,
            COUNT(DISTINCT l.student_id) AS students,
            (SELECT COUNT(*) FROM sys_user u2 WHERE u2.class_id = u.class_id AND u2.status = 1) AS classSize
       FROM af_leave l
       JOIN sys_user u ON u.id = l.student_id
       LEFT JOIN sys_class cl ON cl.id = u.class_id
       LEFT JOIN sys_department d ON d.id = l.dept_id
      WHERE l.created_at > NOW() - INTERVAL ? DAY
      GROUP BY cl.id, cl.name, d.name, u.class_id
     HAVING students >= ?
      ORDER BY students DESC
      LIMIT 10`,
    [days, THRESHOLDS.leaveMinStudents],
  );
  for (const r of leaveRows) {
    const size = WD(r.classSize);
    const ratio = size > 0 ? WD(r.students) / size : 0;
    if (ratio >= THRESHOLDS.leaveRatio) {
      findings.push({
        key: 'leave_cluster',
        level: 'high',
        title: `「${r.className}」请假集中`,
        detail: `近 ${days} 天该班 ${r.students}/${size} 人请假（占 ${(ratio * 100).toFixed(0)}%），共 ${r.times} 人次。院系：${r.deptName}`,
        count: WD(r.students),
      });
    }
  }

  // ---- ② 成绩录入缺失：往期教学班仍有学生未出成绩 ----
  const scoreRows = await query(
    `SELECT c.name AS courseName, c.code AS courseCode, t.real_name AS teacherName,
            x.term, COUNT(*) AS missing
       FROM edu_elect e
       JOIN edu_class x ON x.id = e.class_id
       JOIN edu_course c ON c.id = x.course_id
       JOIN sys_user t ON t.id = x.teacher_id
      WHERE e.status = 1 AND x.status = 1 AND x.term < (SELECT MAX(term) FROM edu_class)
      GROUP BY x.id, c.name, c.code, t.real_name, x.term
      ORDER BY missing DESC
      LIMIT 10`,
    [],
  );
  for (const r of scoreRows) {
    findings.push({
      key: 'score_missing',
      level: 'high',
      title: `「${r.courseName}」成绩未录完`,
      detail: `${r.term} 学期 · 教师 ${r.teacherName || '-'} · ${r.missing} 名学生尚未录入成绩`,
      count: WD(r.missing),
    });
  }

  // ---- ③ 图书逾期 ----
  const [ov] = await query(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users,
            MIN(due_at) AS oldest
       FROM lib_loan WHERE status = 0 AND due_at < NOW()`,
  );
  if (WD(ov?.n) >= THRESHOLDS.overdueMin) {
    findings.push({
      key: 'book_overdue',
      level: 'mid',
      title: '图书逾期较多',
      detail: `当前 ${ov.n} 本未归还且已逾期，涉及 ${ov.users} 人；最早应还日期 ${String(ov.oldest || '').slice(0, 10)}`,
      count: WD(ov.n),
    });
  }

  // ---- ④ 论坛待复核积压（AI 审核与人工复核之间的"人工环节"是否被遗漏）----
  const [bk] = await query(
    `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM ai_review_log WHERE handled = 0`,
  );
  if (WD(bk?.n) > 0) {
    const hours = bk.oldest ? Math.floor((Date.now() - new Date(bk.oldest).getTime()) / 3600000) : 0;
    if (hours >= THRESHOLDS.reviewBacklogHours || WD(bk.n) >= 10) {
      findings.push({
        key: 'review_backlog',
        level: 'mid',
        title: 'AI 审核待复核积压',
        detail: `有 ${bk.n} 条内容待人工复核，最早一条已等待约 ${hours} 小时。请在【AI 管理控制台 → 审核队列】处理`,
        count: WD(bk.n),
      });
    }
  }

  // ---- ⑤ 报修积压：待受理工单堆太久 ----
  const [rp] = await query(
    `SELECT COUNT(*) AS n, MIN(created_at) AS oldest
       FROM af_repair WHERE status = 0 AND created_at < NOW() - INTERVAL 48 HOUR`,
  );
  if (WD(rp?.n) > 0) {
    findings.push({
      key: 'repair_backlog',
      level: 'mid',
      title: '报修工单积压',
      detail: `有 ${rp.n} 个工单超过 48 小时仍未受理，最早提交于 ${String(rp.oldest || '').slice(0, 16)}`,
      count: WD(rp.n),
    });
  }

  return findings.sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === 'high' ? -1 : 1));
}

/**
 * 把 findings 汇总成一段人话（1 次调用；未开启/失败时退化为纯规则文本）
 * @returns {Promise<string>}
 */
export async function explainFindings(findings) {
  const fallback = findings.map((f) => `· ${f.title}：${f.detail}`).join('\n');
  if (!findings.length) return '本轮扫描未发现异常。';
  if (!(await getBool('ai.anomaly.explain', true))) return fallback;
  if (!aiConfigured()) return fallback;

  const t0 = Date.now();
  const r = await aiChat({
    messages: [
      {
        role: 'system',
        content: [
          '你是校园信息化值班助手。下面是系统规则扫描出的异常清单，请用 3~5 句话向管理员做一段简报。',
          '',
          '【要求】',
          '1. 先说要紧的（标 high 的在前），给出**建议的处理动作**（去哪处理、找谁）。',
          '2. 只根据清单内容说，**不要添加清单里没有的数字**，也不要编造原因。',
          '3. 不要重复罗列每一条的原文，要归纳。控制在 200 字内。',
        ].join('\n'),
      },
      { role: 'user', content: findings.map((f) => `[${f.level}] ${f.title}：${f.detail}`).join('\n') },
    ],
    maxTokens: 300,
    temperature: 0.2,
    timeoutMs: 10_000,
  });
  await logAiUsage({
    userId: 0,
    kind: 'anomaly',
    promptTokens: r?.usage?.prompt_tokens ?? 0,
    completionTokens: r?.usage?.completion_tokens ?? 0,
    ok: r?.content ? 1 : 0,
    costMs: Date.now() - t0,
  });
  return r?.content?.trim() || fallback;
}

/**
 * 扫描并按需发告警邮件
 * @param {{notify?:boolean, days?:number}} [opts]
 * @returns {Promise<{findings:object[], summary:string, sent:boolean, sendReason:string}>}
 */
export async function scanAndAlert({ notify = false, days } = {}) {
  const findings = await runChecks({ days });
  const summary = await explainFindings(findings);

  let sent = false;
  let sendReason = 'no-findings';
  if (notify && findings.length) {
    // 去重键按天：同一天内重复扫描不会重复发信（ai.alert.dedupe_min 之外再加一层天级）
    const day = new Date().toISOString().slice(0, 10);
    const res = await alert.dataAnomaly({
      title: `数据异常监测发现 ${findings.length} 项需关注`,
      detail: [`【AI 归纳】`, summary, '', '【明细】', ...findings.map((f) => `· [${f.level}] ${f.title}：${f.detail}`)].join('\n'),
      dedupeKey: `anomaly:${day}`,
    });
    sent = Boolean(res.sent);
    sendReason = res.reason || '';
  } else if (!findings.length) {
    sendReason = 'no-findings';
  } else {
    sendReason = 'not-requested';
  }

  return { findings, summary, sent, sendReason };
}
