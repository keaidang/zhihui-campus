// GET /api/ai/approval-advice?leaveId=123 — C4 AI 审批助手（只建议，不审批）
//
// 权限：counselor / admin（辅导员受"本院"数据范围限制，见 lib/ai-approval.js）
// 返回：`{ enabled:false }`（功能未开启，前端不显示卡片）或建议结构
// 明确不做的事：**不修改任何数据**，不调用 flow_node / af_leave 的写路径。
import { fail, jsonError, ok, preflight } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { adviseLeave, canAdvise } from '../../lib/ai-approval.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const actor = await actorFrom(context);
    if (!canAdvise(actor)) return fail(49403, '你的角色没有审批助手权限', 403);

    const url = new URL(context.request.url);
    const leaveId = Number(url.searchParams.get('leaveId'));
    if (!leaveId) return fail(49401, '缺少 leaveId');

    const advice = await adviseLeave(actor, leaveId, { userId: actor.userId });
    if (!advice) return ok({ enabled: false });
    return ok({ enabled: true, ...advice });
  } catch (e) {
    return jsonError(e);
  }
}
