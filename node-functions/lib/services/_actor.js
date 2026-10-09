// lib/services/_actor.js — 服务层的统一调用约定（唯一口径，后续所有 service 都照此写）
//
// 为什么要服务层（docs/AI-FEATURES.md §4.3）：
//   改造前，权限校验、SQL、审计全部写死在 api/*.js 的 handler 里，AI 无法复用 ——
//   要么重复实现（危险：两套权限逻辑必然漂移），要么让 AI 直接拼 SQL（ADR-9 禁止）。
//   抽成服务层后，**人工点按钮**与**AI 对话触发**走的是同一份代码、同一套权限、同一套审计，
//   论文里可以直接写"AI 与人工同源"。
//
// ★ 三条铁律（写 service 时必须遵守）：
//   1. **actor 只来自 requireRoles()**（实时查库得到的 roles/deptId），绝不接受前端传参
//   2. 业务错误一律 `throw new HttpError(code, message, status?)`；
//      handler 的 jsonError 会把它原样转成 `{code,message}` 响应 —— 与改造前的 fail(code,msg) 逐字节一致
//   3. 返回 `{ data, message }`，由 handler 决定怎么包装（ok / Response / SSE 等）
//
// 反例（不要这么做）：
//   · service 里读 context.request —— 那样 AI 路径无法复用
//   · service 里直接 return fail(...) —— 那是 HTTP 层的事，服务层只表达业务结果

import { requireRoles } from '../guard.js';
import { clientIp } from '../http.js';

/**
 * 从请求上下文构造 Actor（**唯一入口**）。
 * handler 一律用它，不要手工拼 `{ userId, roles }` —— 少传一个字段就可能让服务层
 * 的权限判断静默失效（例如漏传 roles 会被 hasRole 当成"无权限"而误拒，
 * 漏传 deptId 会让"本院"判断退化成全放行，两种都很难在测试里发现）。
 *
 * @param {object} context Node Functions 的请求上下文
 * @param {string[]} [allowed] 允许的角色（空 = 任意登录用户），与原来 handler 里的 requireRoles 一致
 * @returns {Promise<Actor>}
 */
export async function actorFrom(context, allowed = []) {
  const { userId, roles, deptId } = await requireRoles(context, allowed);
  return { userId, roles, deptId: deptId ?? null, ip: clientIp(context.request) };
}

/**
 * @typedef {object} Actor
 * @property {number} userId  操作者 id（来自 JWT + 实时查库校验）
 * @property {string[]} roles 操作者的角色码（**实时查库**，不信令牌）
 * @property {number|null} deptId 操作者所属院系 id
 * @property {string} ip      客户端 IP（审计用）
 * @property {boolean} [viaAi] 本次操作是否由 AI 触发（审计标记，见铁律 #4）
 */

/** 判断 actor 是否拥有任一角色 */
export const hasRole = (actor, codes) => (actor?.roles || []).some((r) => codes.includes(r));

/** 是否是超级管理员 */
export const isAdmin = (actor) => hasRole(actor, ['admin']);

/**
 * 审计留痕的统一入口：AI 触发时在 action 上打 `via:ai` 标记（铁律 #4）
 * @param {Actor} actor
 * @param {string} action 形如 'user.setStatus'
 * @param {string} target 形如 'user:123'
 * @param {string} detail
 */
export function auditDetail(actor, detail) {
  const d = String(detail ?? '');
  return actor?.viaAi ? `via:ai ${d}`.slice(0, 512) : d.slice(0, 512);
}
