// /api/auth/register/send-code — 注册验证码发送
// POST {email} → 发送 6 位验证码（发件人 system@keaidang.com）
// 限流：同邮箱 60s 间隔 / 每邮箱每日 10 封 / 每 IP 每日 20 封；验证码 10 分钟有效
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../../lib/http.js';
import { query } from '../../../lib/db.js';
import { sendVerificationCode } from '../../../lib/lanqin.js';

export { preflight as onRequestOptions };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const email = String(body.email || '').trim().toLowerCase();
    const ip = clientIp(context.request);
    if (!EMAIL_RE.test(email)) return fail(43001, '邮箱格式不正确');

    // 同邮箱 60s 间隔
    const recent = await query(
      `SELECT created_at FROM sys_email_code WHERE email = ? ORDER BY id DESC LIMIT 1`,
      [email],
    );
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000) {
      return fail(43002, '发送太频繁，请 1 分钟后再试');
    }
    // 每邮箱每日 10 封
    const perEmail = await query(
      `SELECT COUNT(*) n FROM sys_email_code WHERE email = ? AND created_at > NOW() - INTERVAL 1 DAY`,
      [email],
    );
    if (Number(perEmail[0].n) >= 10) return fail(43003, '该邮箱今日发送次数已达上限');
    // 每 IP 每日 20 封
    const perIp = await query(
      `SELECT COUNT(*) n FROM sys_email_code WHERE ip = ? AND created_at > NOW() - INTERVAL 1 DAY`,
      [ip],
    );
    if (Number(perIp[0].n) >= 20) return fail(43003, '操作过于频繁，请明天再试');

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const r = await sendVerificationCode(email, code, '注册');
    if (!r.ok) {
      console.error('[send-code] LanQin 发送失败:', r.error);
      return fail(43004, '验证码发送失败 [debug] ' + String(r.error || '').slice(0, 120)
        + ' | mbxId=' + (process.env.LANQIN_SYSTEM_MAILBOX_ID || '(空)')
        + ' | key=' + (process.env.LANQIN_API_KEY ? process.env.LANQIN_API_KEY.slice(0, 8) + '…' : '(空)'));
    }

    await query(
      'INSERT INTO sys_email_code (email, code, purpose, expires_at, ip) VALUES (?, ?, "register", NOW() + INTERVAL 10 MINUTE, ?)',
      [email, code, ip],
    );
    return ok(
      { sent: true, expireMinutes: 10 },
      '验证码已发送，请查收邮件；若未收到请检查垃圾邮件/广告邮件文件夹',
    );
  } catch (e) {
    return jsonError(e);
  }
}
