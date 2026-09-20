// /api/auth/register/domains — 可选校园邮箱域名列表（公开，注册页用）
// GET → { items: ['keaidang.com', '9o.pw', ...] }
import { ok, jsonError, preflight } from '../../../lib/http.js';
import { listDomains } from '../../../lib/lanqin.js';

export { preflight as onRequestOptions };

export async function onRequestGet() {
  try {
    const r = await listDomains();
    const fallback = ['keaidang.com'];
    const items = r.ok && r.items?.length ? r.items.map((x) => x.name) : fallback;
    return ok({ items });
  } catch (e) {
    return jsonError(e);
  }
}
