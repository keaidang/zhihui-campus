// node-functions/lib/lanqin.js — LanQin Email 开放 API 封装
// 用途：注册验证码发送、校园邮箱（真实邮箱）创建/改密
// 环境变量：LANQIN_API_KEY / LANQIN_BASE_URL / LANQIN_DOMAIN_ID / LANQIN_SEND_MAILBOX_ID / LANQIN_SYSTEM_ADDRESS
const BASE = process.env.LANQIN_BASE_URL || 'https://email.9o.pw';
const KEY = process.env.LANQIN_API_KEY || '';
const DOMAIN_ID = process.env.LANQIN_DOMAIN_ID || '';
// 发信专用邮箱（k@keaidang.com）；SYSTEM_MAILBOX_ID(system@) 作为回退
const SEND_MAILBOX_ID = process.env.LANQIN_SEND_MAILBOX_ID || process.env.LANQIN_SYSTEM_MAILBOX_ID || '';
const SYSTEM_ADDRESS = process.env.LANQIN_SYSTEM_ADDRESS || 'system@keaidang.com';
// 主用户 ID：API 新建邮箱必须归属该用户，否则 /send 报 404（不属于 Token 拥有者）
const OWNER_USER_ID = process.env.LANQIN_OWNER_USER_ID || '';

export const lanqinConfigured = () => Boolean(KEY && SEND_MAILBOX_ID);

async function call(method, path, body) {
  const res = await fetch(`${BASE}/api/open/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

/** 发送验证码邮件（发件人 system@keaidang.com） */
export async function sendVerificationCode(to, code, purpose = '注册') {
  if (!lanqinConfigured()) return { ok: false, error: '邮件服务未配置' };
  const html = `<div style="max-width:520px;margin:0 auto;font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#1e293b">
  <div style="background:#17325c;border-radius:12px 12px 0 0;padding:18px 24px;color:#fff;font-size:16px;letter-spacing:1px">智汇校园 · ${purpose}验证码</div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px">
    <p style="margin:0 0 14px;font-size:14px">您好！您正在进行<b>${purpose}</b>操作，验证码为：</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#17325c;background:#f0f4f9;border-radius:8px;padding:14px 0;text-align:center">${code}</div>
    <p style="margin:16px 0 4px;font-size:13px;color:#475569">验证码 <b>10 分钟</b>内有效，请勿泄露给他人。</p>
    <p style="margin:0;font-size:12px;color:#94a3b8">如非本人操作，请忽略本邮件。系统发件邮箱：${SYSTEM_ADDRESS}</p>
  </div>
</div>`;
  const r = await call('POST', '/send', {
    mailboxId: SEND_MAILBOX_ID,
    to: [to],
    subject: `【智汇校园】${purpose}验证码：${code}（10 分钟内有效）`,
    html,
    text: `【智汇校园】${purpose}验证码：${code}，10 分钟内有效。若未收到请检查垃圾邮件文件夹。`,
  });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${r.data?.error || r.data?.message || '发送失败'}` };
  return { ok: true, id: r.data?.id, status: r.data?.status };
}

/** 查询发送状态：relayed+delivered 为成功 */
export async function querySend(id) {
  const r = await call('GET', `/send/${id}`);
  return r.ok ? r.data : null;
}

/**
 * 创建真实邮箱（开通对外收发时调用）
 * @returns {ok, mailboxId, address, error}
 */
export async function createMailbox(localPart, password, displayName) {
  if (!KEY || !DOMAIN_ID) return { ok: false, error: '邮件服务未配置' };
  const r = await call('POST', '/mailboxes', {
    domainId: DOMAIN_ID,
    localPart,
    password,
    displayName: displayName || undefined,
    quotaMb: 1024,
    ...(OWNER_USER_ID ? { userId: OWNER_USER_ID } : {}),
  });
  if (!r.ok) {
    const msg = r.data?.error || r.data?.message || `HTTP ${r.status}`;
    return { ok: false, error: msg, status: r.status };
  }
  return { ok: true, mailboxId: r.data?.id, address: r.data?.address };
}

/** 删除邮箱（回退用） */
export async function deleteMailbox(mailboxId) {
  const r = await call('DELETE', `/mailboxes/${mailboxId}`);
  return r.ok;
}

/** 重置邮箱密码（LanQin 会同时重置其拥有者用户密码） */
export async function resetMailboxPassword(mailboxId, newPassword) {
  const r = await call('POST', `/mailboxes/${mailboxId}/password`, { password: newPassword });
  if (!r.ok) return { ok: false, error: r.data?.error || `HTTP ${r.status}` };
  return { ok: true };
}

/** 检查邮箱前缀在邮件服务器是否已被占用（列出后按 localPart 匹配，尽力而为） */
export async function isLocalPartTaken(localPart) {
  try {
    const r = await call('GET', `/mailboxes?limit=100&q=${encodeURIComponent(localPart)}`);
    if (!r.ok) return null; // 查询失败时不阻塞（创建时服务器还会兜底校验）
    const items = r.data?.items || [];
    return items.some((m) => String(m.localPart || '').toLowerCase() === localPart.toLowerCase() && m.status === 'active');
  } catch {
    return null; // 网络异常同样不阻塞
  }
}

// ---- 用户校园邮箱收发（/api/mail/* 使用）----

/** 读收件箱列表（分页 cursor） */
export async function listMessages(mailboxId, { limit = 20, cursor = '' } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  const r = await call('GET', `/mailboxes/${encodeURIComponent(mailboxId)}/messages?${qs.toString()}`);
  if (!r.ok) return { ok: false, error: r.data?.error || r.data?.message || `HTTP ${r.status}` };
  return { ok: true, items: r.data?.items || [], nextCursor: r.data?.nextCursor || '' };
}

/** 读邮件详情（含正文） */
export async function getMessage(messageId) {
  const r = await call('GET', `/messages/${encodeURIComponent(messageId)}`);
  if (!r.ok) return { ok: false, error: r.data?.error || r.data?.message || `HTTP ${r.status}` };
  return { ok: true, message: r.data };
}

/** 以用户自己的校园邮箱发信（开通对外收发后可用） */
export async function sendUserMail(mailboxId, to, subject, html, text) {
  const r = await call('POST', '/send', {
    mailboxId,
    to: Array.isArray(to) ? to : [to],
    subject,
    html: html || undefined,
    text: text || undefined,
  });
  if (!r.ok) {
    return { ok: false, error: r.data?.error || r.data?.message || `HTTP ${r.status}` };
  }
  return { ok: true, id: r.data?.id, status: r.data?.status };
}
