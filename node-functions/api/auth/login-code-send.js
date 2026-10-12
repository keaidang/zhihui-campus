// /api/auth/login-code-send — 邮箱免密登录：发送验证码
// POST { email } → 检查账号绑定 + 发送 6 位验证码（purpose='login'）
// 限流：60s 间隔 / 每日 10 封；10 分钟有效
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { query } from '../../lib/db.js';
import { sendVerificationCode } from '../../lib/lanqin.js';

export { preflight as onRequestOptions };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const email = String(body.email || '').trim().toLowerCase();
    const ip = clientIp(context.request);

    if (!email) return fail(41001, '请输入邮箱地址');
    if (!EMAIL_RE.test(email)) return fail(41002, '邮箱格式不正确');

    // 账号存在性检查（必须是已绑定该邮箱且处于启用状态的用户）
    const users = await query(
      'SELECT id, username, real_name, status FROM sys_user WHERE email = ? LIMIT 1',
      [email],
    );
    if (users.length === 0) {
      return fail(40401, '该邮箱未绑定有效账号，请核对或使用密码登录');
    }
    const user = users[0];
    if (Number(user.status) !== 1) {
      return fail(40300, '该账号已被停用，请联系管理员');
    }

    // 限流：同邮箱 60s 间隔
    const recent = await query(
      'SELECT created_at FROM sys_email_code WHERE email = ? AND purpose = "login" ORDER BY id DESC LIMIT 1',
      [email],
    );
    if (recent.length > 0 && Date.now() - new Date(recent[0].created_at).getTime() < 60_000) {
      return fail(42901, '发送过于频繁，请 1 分钟后再试');
    }

    // 限流：每邮箱每日 10 封
    const perEmail = await query(
      'SELECT COUNT(*) n FROM sys_email_code WHERE email = ? AND purpose = "login" AND created_at > NOW() - INTERVAL 1 DAY',
      [email],
    );
    if (Number(perEmail[0].n) >= 10) {
      return fail(42902, '该邮箱今日验证码发送已达上限');
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const r = await sendVerificationCode(email, code, '免密登录');
    if (!r.ok) {
      console.error('[login-code-send] 发送失败:', r.error);
      return fail(43004, '验证码发送失败，请稍后重试');
    }

    await query(
      'INSERT INTO sys_email_code (email, code, purpose, expires_at, ip) VALUES (?, ?, "login", NOW() + INTERVAL 10 MINUTE, ?)',
      [email, code, ip],
    );

    return ok({ sent: true, expireMinutes: 10 }, '验证码已发送至邮箱，请查收（未收到请检查垃圾邮件）');
  } catch (e) {
    return jsonError(e);
  }
}
