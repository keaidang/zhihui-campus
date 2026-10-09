// /api/admin/users — 账号管理（HTTP 薄壳）
// 权限：admin（全校）、counselor（仅本院，且不能改角色/删除/创建）
// GET  分页列表  ?keyword=&role=&deptId=&status=&page=1&pageSize=20
//                ?export=csv → 全量导出（UTF-8 BOM，Excel 兼容）
// POST 单条操作  { userId, action: setStatus | setRoles | setProfile | setValidUntil | delete | create | batchCreate | batchDelete, value }
//
// ★ P4 服务层重构（2026-10-09）：业务逻辑在 lib/services/users.js。
//   本文件只剩「鉴权门槛 → 构造 actor → 调 service → 包装响应（含 CSV 下载）」。
import { ok, jsonError, readBody, preflight } from '../../lib/http.js';
import { MANAGER_ROLES } from '../../lib/guard.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { exportUsersCsv, handleUserAction, listUsers } from '../../lib/services/users.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const actor = await actorFrom(context, MANAGER_ROLES);
    const url = new URL(context.request.url);

    if (url.searchParams.get('export') === 'csv') {
      const r = await exportUsersCsv(actor);
      return new Response(r.data.csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const r = await listUsers(actor, {
      keyword: url.searchParams.get('keyword') || '',
      role: url.searchParams.get('role') || '',
      status: url.searchParams.get('status'),
      lastLogin: url.searchParams.get('lastLogin') || '',
      page: url.searchParams.get('page') || 1,
      pageSize: url.searchParams.get('pageSize') || 20,
    });
    return ok(r.data);
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context, MANAGER_ROLES);
    const body = await readBody(context.request);
    const r = await handleUserAction(actor, body);
    return ok(r.data, r.message);
  } catch (e) {
    return jsonError(e);
  }
}
