// /api/mail — 用户校园邮箱（仅开通对外收发的用户）
// GET  /api/mail                收件箱列表 ?limit=&cursor=
// GET  /api/mail/detail?id=     邮件详情（见 detail.js）
// POST /api/mail                发信 { to, subject, html, text }（每日 50 封）
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireAuth, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { listMessages, sendUserMail } from '../../lib/lanqin.js';

export { preflight as onRequestOptions };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAILY_SEND_LIMIT = 50;

/** 从 token 解析用户并校验已开通对外收发；返回 { user, mailboxId, address } 或 { error } */
export function requireMailbox(context) {
  let payload;
  try {
    payload = requireAuth(context);
  } catch {
    return { error: fail(40101, '登录已过期，请重新登录', 401) };
  }
  return query(
    'SELECT id, username, real_name, campus_email, mail_enabled, mail_mailbox_id FROM sys_user WHERE id = ? AND status = 1',
    [Number(payload.sub)],
  ).then((users) => {
    if (!users.length) return { error: fail(40101, '用户不存在或已禁用', 401) };
    const u = users[0];
    if (!u.mail_enabled || !u.mail_mailbox_id) {
      return { error: fail(43300, '校园邮箱对外收发未开通，请联系管理员开通') };
    }
    return { user: u, mailboxId: u.mail_mailbox_id, address: u.campus_email };
  });
}

/** 收件箱列表 */
export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const ctx = await requireMailbox(context);
    if (ctx.error) return ctx.error;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const cursor = String(url.searchParams.get('cursor') || '');
    const r = await listMessages(ctx.mailboxId, { limit, cursor });
    if (!r.ok) return fail(43310, `读取收件箱失败：${r.error}`);
    return ok({
      address: ctx.address,
      items: (r.items || []).map((m) => ({
        id: m.id, from: m.from, subject: m.subject, snippet: m.snippet,
        receivedAt: m.receivedAt || m.createdAt, seen: m.seen,
      })),
      nextCursor: r.nextCursor,
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const ctx = await requireMailbox(context);
    if (ctx.error) return ctx.error;
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim().slice(0, 200);
    const html = String(body.html || '').slice(0, 200_000);
    const text = String(body.text || '').slice(0, 100_000);
    if (!EMAIL_RE.test(to)) return fail(43320, '收件人邮箱格式不正确');
    if (!subject) return fail(43320, '请填写邮件主题');
    if (!html && !text) return fail(43320, '请填写邮件正文');

    // 每日发信限额（按操作日志计数）
    const sent = await query(
      "SELECT COUNT(*) AS n FROM sys_op_log WHERE action = 'mail.send' AND operator_id = ? AND created_at >= NOW() - INTERVAL 1 DAY",
      [ctx.user.id],
    );
    if (Number(sent[0]?.n) >= DAILY_SEND_LIMIT) return fail(43321, '已达每日发信上限（50 封），请明天再试');

    const r = await sendUserMail(ctx.mailboxId, to, subject, html, text);
    if (!r.ok) return fail(43322, `发送失败：${r.error}`);
    await opLog(ctx.user.id, 'mail.send', to, subject, ip);
    return ok({ id: r.id, status: r.status }, '已提交发送，稍后送达');
  } catch (e) {
    return jsonError(e);
  }
}
