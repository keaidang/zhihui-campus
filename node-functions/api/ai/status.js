// GET /api/ai/status — AI 能力清单（按登录角色返回）
//
// 前端用它决定：是否显示「AI 助手」菜单与悬浮球、渲染哪个版本的主色、
// 显示哪些能力项、以及给什么候选问题。**未配置密钥时全部能力为 false**，
// 前端据此整体隐藏入口（而不是点进去再报错）。
import { ok, preflight, jsonError } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { aiConfigured, aiMeta } from '../../lib/ai.js';
import { allConfig, getBool } from '../../lib/ai-config.js';
import { VARIANT_META, featureCatalog, resolveFeatures, suggestionsFor, variantOf } from '../../lib/ai-variant.js';
import { actionCatalog } from '../../lib/ai-actions.js';
import { insightCatalog } from '../../lib/ai-insight.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  // ★ 统一错误包装（全站 41/44 个 handler 的既有约定，铁律 #3）：
  //   边缘运行时没有控制台，未捕获异常会被平台换成 HTML 错误页 —— 前端 res.json()
  //   解析失败只能显示默认兜底文案，线上无法定位。jsonError 会落 sys_op_log(error.500)。
  try {
    const { roles } = await requireRoles(context);

    const configured = aiConfigured();
    const enabled = await getBool('ai.enabled', true); // AI 总开关
    const cfg = await allConfig();

    const features = enabled ? resolveFeatures(roles, cfg, configured) : {};
    const variant = variantOf(roles);

    // ★ 动作清单必须按**注册表**返回，而不是挂在 `features.adminAction` 上（2026-10-20 修复）。
    //   原因：`adminAction` 的 roles 只有 admin，而注册表里 counselor 有 9 个、teacher 有 3 个动作
    //   （禁用/启用本院账号、批准/驳回请假、发/撤公告）。原写法让这两个角色拿到空数组，
    //   前端 `routeOf()` 因此永远走"纯问答"分支 —— **后端支持、页面上却用不了**，
    //   用户感受到的就是"审批请假怎么说都没用"。
    const actionSwitch = cfg['ai.admin_console.enabled'] === undefined ? true : String(cfg['ai.admin_console.enabled']) === '1';
    const actionList = configured && enabled && actionSwitch ? actionCatalog({ userId: 0, roles }) : [];

    return ok({
      ...aiMeta(), // { provider, model, configured }
      role: roles[0] || 'student',
      roles,
      variant,
      variantLabel: VARIANT_META[variant].label,
      variantDesc: VARIANT_META[variant].desc,
      features,
      catalog: featureCatalog(roles, features),
      // C5：该角色可用的系统操作白名单（前端据此渲染"能力清单"；无权限时为空数组）
      actions: actionList,
      // 动作注册表对全员可见的能力项（前端用来决定是否走"指令"链路）
      canAct: actionList.length > 0,
      // C6：该角色可用的问数模板（校领导/管理员）
      insights: features.insight ? insightCatalog({ userId: 0, roles }) : [],
      suggestions: features.chat ? suggestionsFor(variant) : [],
      // degraded：入口可展示但没有可用能力时的说明（前端顶部横幅用）
      degraded: !configured || !enabled,
      degradedReason: !configured ? 'AI 服务尚未配置' : !enabled ? 'AI 服务已被管理员关闭' : '',
    });
  } catch (e) {
    return jsonError(e);
  }
}
