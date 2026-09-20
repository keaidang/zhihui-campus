// /api/mail — 用户校园邮箱（仅开通对外收发的用户）
// GET  /api/mail                收件箱列表 ?limit=&cursor=
// GET  /api/mail?action=sent    已发邮件列表（本地 sys_mail_sent）
// GET  /api/mail/detail?id=     邮件详情（见 detail.js）
// POST /api/mail                发信 { to, subject, html, text }（每日 50 封）
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireAuth, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { listMessages, sendUserMail, querySend } from '../../lib/lanqin.js';

export { preflight as onRequestOptions };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAILY_SEND_LIMIT = 50;
// 已发邮件状态回查节流：mailId -> 上次回查时间戳
const SENT_CHECK_AT = new Map();

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

/** 收件箱 / 已发邮件列表 */
export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const ctx = await requireMailbox(context);
    if (ctx.error) return ctx.error;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 20)));

    // 已发邮件：本地库分页（id 游标）
    if (url.searchParams.get('action') === 'sent') {
      const before = Number(url.searchParams.get('before') || 0);
      const rows = await query(
        `SELECT id, mail_id, to_addr, subject, snippet, status, created_at
           FROM sys_mail_sent WHERE user_id = ? ${before ? 'AND id < ?' : ''}
          ORDER BY id DESC LIMIT ${limit}`,
        before ? [ctx.user.id, before] : [ctx.user.id],
      );
      // 排队/投递中的邮件回查最新投递状态并回写（模块级 60s 节流，单次最多 8 封）
      const now = Date.now();
      let refreshed = 0;
      for (const r of rows) {
        if (refreshed >= 8) break;
        if (!r.mail_id || !['queued', 'sending'].includes(String(r.status))) continue;
        if (now - (SENT_CHECK_AT.get(r.mail_id) || 0) < 60_000) continue;
        SENT_CHECK_AT.set(r.mail_id, now);
        refreshed++;
        try {
          const s = await querySend(r.mail_id);
          const st = String(s?.status || s?.queueStatus || '').toLowerCase();
          if (st && st !== r.status) {
            await query('UPDATE sys_mail_sent SET status = ? WHERE id = ?', [st, r.id]);
            r.status = st;
          }
        } catch { /* 状态回查失败不影响列表 */ }
      }
      return ok({
        address: ctx.address,
        items: rows.map((r) => ({
          id: String(r.id), mailId: r.mail_id, to: r.to_addr, subject: r.subject,
          snippet: r.snippet, status: r.status, sentAt: r.created_at,
        })),
        nextCursor: rows.length === limit ? String(rows[rows.length - 1].id) : '',
      });
    }

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
    // 记入已发邮件（"已发送"页签数据源）
    const snippet = String(text || html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    await query(
      `INSERT INTO sys_mail_sent (user_id, mailbox_id, mail_id, to_addr, subject, snippet, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ctx.user.id, ctx.mailboxId, r.id || null, to, subject, snippet, r.status || 'queued'],
    );
    return ok({ id: r.id, status: r.status }, '已提交发送，稍后送达');
  } catch (e) {
    return jsonError(e);
  }
}
