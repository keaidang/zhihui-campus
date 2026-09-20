// /api/auth/register/prefix-check — 校园邮箱前缀占用检查
// GET ?prefix=xxx&domain=keaidang.com → { available, reason? }
// 校验两层：系统内 campus_email 唯一 + 邮件服务器未被占用
import { ok, fail, jsonError, preflight } from '../../../lib/http.js';
import { query } from '../../../lib/db.js';
import { isLocalPartTaken, isDomainAllowed } from '../../../lib/lanqin.js';

export { preflight as onRequestOptions };

const PREFIX_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const prefix = String(url.searchParams.get('prefix') || '').trim().toLowerCase();
    const domain = String(url.searchParams.get('domain') || 'keaidang.com').trim().toLowerCase();
    if (!PREFIX_RE.test(prefix)) {
      return ok({ available: false, reason: '前缀需为 3~30 位小写字母/数字/._- 且以字母或数字开头' });
    }
    // 域名白名单校验
    const domOk = await isDomainAllowed(domain);
    if (domOk === false) return ok({ available: false, reason: '该邮箱域名不可用' });
    // 系统内占用检查
    const rows = await query('SELECT id FROM sys_user WHERE campus_email = ?', [`${prefix}@${domain}`]);
    if (rows.length) return ok({ available: false, reason: '该前缀已被占用' });
    // 邮件服务器占用检查（尽力而为）
    const taken = await isLocalPartTaken(prefix);
    if (taken) return ok({ available: false, reason: '该前缀在邮件服务器已被占用' });
    return ok({ available: true });
  } catch (e) {
    return jsonError(e);
  }
}
