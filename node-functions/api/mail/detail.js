// /api/mail/detail?id= — 邮件详情（仅本人邮箱的邮件）
import { ok, fail, jsonError, preflight } from '../../lib/http.js';
import { getMessage } from '../../lib/lanqin.js';
import { requireMailbox } from './index.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) return fail(43310, '缺少邮件 id');
    const ctx = await requireMailbox(context);
    if (ctx.error) return ctx.error;
    const r = await getMessage(id);
    if (!r.ok) return fail(43311, `读取邮件失败：${r.error}`);
    const m = r.message || {};
    // 归属校验：邮件必须属于该用户的邮箱（接口返回 mailboxId 时严格校验）
    if (m.mailboxId && m.mailboxId !== ctx.mailboxId) return fail(43312, '无权查看该邮件', 403);
    return ok({
      id: m.id, from: m.from, to: m.to, subject: m.subject,
      html: m.html, text: m.text, snippet: m.snippet,
      receivedAt: m.receivedAt || m.createdAt, attachments: m.attachments || [],
    });
  } catch (e) {
    return jsonError(e);
  }
}
