// /api/ai/anomaly — C11 数据异常监测（仅超管）
//
// GET  → 立即扫描并返回异常清单（不发邮件；纯 SQL 检测，零模型成本）
// POST → { notify?: boolean } 扫描，notify=true 时把结果邮件推送给管理员
//
// 为什么不做成定时任务：EdgeOne Pages 的定时触发需要额外配置，而"管理员点一下"已经覆盖
//   毕设场景（也更容易在答辩现场演示）。检测逻辑与触发方式解耦在 lib/ai-anomaly.js，
//   将来接定时器只需在这个端点外面加一个 cron 调用即可。
import { ok, fail, jsonError, preflight, readBody } from '../../lib/http.js';
import { requireRoles, opLog, clientIp } from '../../lib/guard.js';
import { getBool } from '../../lib/ai-config.js';
import { runChecks, scanAndAlert } from '../../lib/ai-anomaly.js';

export { preflight as onRequestOptions };

const OFF_MSG = '数据异常监测未开启，请到【AI 管理控制台 → 功能开关】开启「数据异常监测」';

export async function onRequestGet(context) {
  try {
    await requireRoles(context, ['admin']);
    if (!(await getBool('ai.anomaly.enabled', false))) return fail(49430, OFF_MSG, 503);
    const findings = await runChecks();
    return ok({ findings, checkedAt: new Date().toISOString() });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId } = await requireRoles(context, ['admin']);
    if (!(await getBool('ai.anomaly.enabled', false))) return fail(49430, OFF_MSG, 503);
    const body = await readBody(context.request, 4 * 1024);
    const notify = body.notify !== false; // 默认发邮件

    const r = await scanAndAlert({ notify });
    await opLog(
      userId,
      'ai.anomaly.scan',
      `findings:${r.findings.length}`,
      `notify=${notify} sent=${r.sent}(${r.sendReason})`,
      clientIp(context.request),
    );
    return ok(r, r.findings.length ? `扫描完成，发现 ${r.findings.length} 项需关注${r.sent ? '，已邮件通知' : ''}` : '扫描完成，未发现异常');
  } catch (e) {
    return jsonError(e);
  }
}
