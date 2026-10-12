// GET /api/ai/briefing — C17 数据驾驶舱 · 一键生成校园周运行态势简报
//
// 权限：仅 admin 与 leader 角色（与驾驶舱权限严格一致）。
// 原则：所有事实数据由后端纯 SQL 聚合算出（真实、不可篡改），
// 模型只负责结构化提炼、宏观综述与决策建议归纳，全程不接触 SQL 文本。
// 铁律 #36：纯文本输入输出。
import { preflight, ok, fail, jsonError } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { aiConfigured, aiJson, aiModel, logAiUsage } from '../../lib/ai.js';
import { getBool } from '../../lib/ai-config.js';
import { consumeAiQuota, releaseAiQuota } from '../../lib/ai-guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  let held = 0;
  const t0 = Date.now();
  try {
    const { userId } = await requireRoles(context, ['admin', 'leader']);

    if (!aiConfigured()) return fail(49400, '态势简报功能暂未开通，请联系管理员', 503);
    if (!(await getBool('ai.enabled', true))) return fail(49430, 'AI 服务已被管理员暂时关闭', 503);

    const quota = await consumeAiQuota(userId, 'insight');
    if (!quota.ok) return fail(49429, quota.message, 429);
    held = userId;

    // ── 1. 纯 SQL 聚合近 7 日全校运行核心事实 ──
    const [userCount] = await query('SELECT COUNT(*) AS total FROM sys_user');
    const [loginCount] = await query(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS active_users
         FROM sys_login_log
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    );

    const [leaveStats] = await query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) AS done
         FROM af_leave
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    );

    const [repairStats] = await query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS processing,
              SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) AS rejected
         FROM af_repair
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    );

    const [loanStats] = await query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) AS active_loans,
              SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS returned,
              SUM(CASE WHEN status = 0 AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue
         FROM lib_loan
        WHERE borrowed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    );

    const [forumStats] = await query(
      `SELECT (SELECT COUNT(*) FROM forum_thread WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS threads,
              (SELECT COUNT(*) FROM forum_reply WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS posts`,
    );

    const [opStats] = await query(
      `SELECT COUNT(*) AS ops,
              SUM(CASE WHEN action LIKE 'error%' OR action = 'ai.error' THEN 1 ELSE 0 END) AS errors
         FROM sys_op_log
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    );

    const facts = [
      `全校注册账号数：${Number(userCount.total || 0)} 人`,
      `近7日登录人次：${Number(loginCount.n || 0)} 次，活跃独立用户：${Number(loginCount.active_users || 0)} 人`,
      `近7日请假申请：共 ${Number(leaveStats.total || 0)} 笔（待批 ${Number(leaveStats.pending || 0)}，已批 ${Number(leaveStats.approved || 0)}，驳回 ${Number(leaveStats.rejected || 0)}，已销假 ${Number(leaveStats.done || 0)}）`,
      `近7日后勤报修：共 ${Number(repairStats.total || 0)} 笔（待受理 ${Number(repairStats.pending || 0)}，维修中 ${Number(repairStats.processing || 0)}，已修好 ${Number(repairStats.done || 0)}，无法受理 ${Number(repairStats.rejected || 0)}）`,
      `近7日图书借阅：借出 ${Number(loanStats.total || 0)} 册（当前在借 ${Number(loanStats.active_loans || 0)}，已还 ${Number(loanStats.returned || 0)}，逾期 ${Number(loanStats.overdue || 0)}）`,
      `近7日师生论坛：新发帖子 ${Number(forumStats.threads || 0)} 篇，互动回复 ${Number(forumStats.posts || 0)} 条`,
      `近7日系统操作：共 ${Number(opStats.ops || 0)} 次审计流水，记录异常告警/错误 ${Number(opStats.errors || 0)} 次`,
    ].join('\n');

    const systemPrompt = [
      '你是一位高校数字校园运行态势决策分析专家。',
      '请根据提供的全校真实运行事实，编写一份《校园数字化运行态势综合简报》。',
      '简报面向校领导与行政主管，要求：客观严谨、重点突出、逻辑严密、富有管理前瞻性。',
      '必须返回纯 JSON 对象，格式如下：',
      '{',
      '  "title": "智慧校园运行态势周报综述",',
      '  "period": "近 7 日运行态势",',
      '  "summary": "150字左右的综合全貌综述",',
      '  "sections": [',
      '    { "tag": "学工生活", "title": "请假与生活保障动态", "content": "70-120字" },',
      '    { "tag": "图书学术", "title": "图书流通与知识获取", "content": "70-120字" },',
      '    { "tag": "网络社群", "title": "论坛交流与舆情活跃度", "content": "70-120字" },',
      '    { "tag": "运维安全", "title": "系统负荷与稳定性保障", "content": "70-120字" }',
      '  ],',
      '  "suggestions": [',
      '    "针对上述数据的建设性管理建议1",',
      '    "针对上述数据的建设性管理建议2",',
      '    "针对上述数据的建设性管理建议3"',
      '  ]',
      '}',
    ].join('\n');

    const parsed = await aiJson({
      system: systemPrompt,
      user: `【过去7天全校运行核心数据指标清单】：\n${facts}`,
      maxTokens: 850,
      timeoutMs: 16000,
    });

    if (!parsed || !parsed.summary || !Array.isArray(parsed.sections)) {
      await logAiUsage({ userId, kind: 'briefing', model: aiModel(), ok: 0, costMs: Date.now() - t0 });
      return fail(49430, '态势简报生成失败，请稍后重试', 503);
    }

    await logAiUsage({
      userId,
      kind: 'briefing',
      model: aiModel(),
      ok: 1,
      costMs: Date.now() - t0,
    });

    return ok({
      title: String(parsed.title || '智慧校园运行态势周报综述'),
      period: String(parsed.period || '近 7 日'),
      summary: String(parsed.summary || ''),
      sections: parsed.sections,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return jsonError(e);
  } finally {
    if (held) releaseAiQuota(held);
  }
}
