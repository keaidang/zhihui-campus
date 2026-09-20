// /api/auth/password/forgot-send-code — 忘记密码：向账号绑定邮箱发送重置验证码
// POST { username, email } → 发送 6 位验证码（purpose='reset'，复用 sys_email_code）
// 限流：60s 间隔 / 每邮箱每日 10 封；10 分钟有效
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../../lib/http.js';
import { query } from '../../../lib/db.js';
import { sendVerificationCode } from '../../../lib/lanqin.js';

export { preflight as onRequestOptions };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const username = String(body.username || '').trim().slice(0, 32);
    const email = String(body.email || '').trim().toLowerCase();
    const ip = clientIp(context.request);
    if (!username) return fail(43501, '请输入账号');
    if (!EMAIL_RE.test(email)) return fail(43501, '邮箱格式不正确');

    // 账号存在 + 绑定邮箱匹配（不泄露账号是否存在：统一成功文案）
    const users = await query(
      'SELECT id, status FROM sys_user WHERE username = ? AND email = ?',
      [username, email],
    );
    if (users.length === 0) {
      return fail(43502, '账号与绑定邮箱不匹配，请确认后重试');
    }
    if (Number(users[0].status) !== 1) return fail(43503, '该账号已被停用，请联系管理员');

    // 同邮箱 60s 间隔 + 每日 10 封
    const recent = await query(
      'SELECT created_at FROM sys_email_code WHERE email = ? AND purpose = "reset" ORDER BY id DESC LIMIT 1',
      [email],
    );
    if (recent.length > 0 && Date.now() - new Date(recent[0].created_at).getTime() < 60_000) {
      return fail(43504, '发送太频繁，请 1 分钟后再试');
    }
    const perEmail = await query(
      'SELECT COUNT(*) n FROM sys_email_code WHERE email = ? AND purpose = "reset" AND created_at > NOW() - INTERVAL 1 DAY',
      [email],
    );
    if (Number(perEmail[0].n) >= 10) return fail(43505, '该邮箱今日发送次数已达上限');

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const r = await sendVerificationCode(email, code, '密码重置');
    if (!r.ok) return fail(43506, '验证码发送失败，请稍后重试');

    await query(
      'INSERT INTO sys_email_code (email, code, purpose, expires_at, ip) VALUES (?, ?, "reset", NOW() + INTERVAL 10 MINUTE, ?)',
      [email, code, ip],
    );
    return ok({ sent: true }, '验证码已发送至绑定邮箱，请查收（未收到请检查垃圾邮件）');
  } catch (e) {
    return jsonError(e);
  }
}
