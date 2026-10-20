// POST /api/auth/login — 统一登录（JWT 双令牌 + 失败锁定 + 审计）
import bcrypt from 'bcryptjs';
import { query } from '../../lib/db.js';
import { ok, fail, jsonError, readBody, clientIp } from '../../lib/http.js';
import { signAccessToken, newRefreshToken, saveRefreshToken, isLocked, recordFail, clearFail, pickLoginRow } from '../../lib/auth.js';
import { buildSessionUser } from '../../lib/user-profile.js';
import { preflight } from '../../lib/http.js';
import { alert } from '../../lib/alert.js';

export { preflight as onRequestOptions };

/**
 * 疑似撞库告警（C3）：同一账号 10 分钟内失败 ≥ 10 次。
 * · 按"账号"维度统计（撞库的本质就是按账号爆破；Node 侧 x-forwarded-for 是出口代理池 IP，不可靠）
 * · 去重键带小时粒度 → 同一账号每小时最多一封邮件
 * · alertAdmins 内部吞掉所有异常，不会影响登录响应
 */
async function alertBruteforce(username, ip) {
  try {
    const [r] = await query(
      'SELECT COUNT(*) AS n FROM sys_login_log WHERE username = ? AND success = 0 AND created_at > NOW() - INTERVAL 10 MINUTE',
      [username],
    );
    const n = Number(r?.n || 0);
    if (n < 10) return;
    const hour = new Date().toISOString().slice(0, 13);
    await alert.loginBruteforce({
      title: `账号 ${username} 10 分钟内登录失败 ${n} 次，疑似撞库`,
      detail: [
        `目标账号：${username}`,
        `10 分钟内失败次数：${n}`,
        `最近来源 IP（可能为出口代理）：${ip}`,
        '',
        '建议动作：确认该账号是否正常；如确为攻击，可在【账号管理】中改密或临时禁用该账号，',
        '并检查 sys_login_log 中同 IP 是否还在试探其他账号。',
      ].join('\n'),
      dedupeKey: `brute:${username}:${hour}`,
    });
  } catch (e) {
    // 告警链路异常绝不能影响登录本身
    console.error('[bruteforce-alert-fail]', e?.message);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const username = String(body.username || '').trim().slice(0, 32);
    const password = String(body.password || '');
    const ip = clientIp(context.request);
    const ua = (context.request.headers.get('user-agent') || '').slice(0, 255);
    const lockKey = `${ip}:${username}`;

    if (!username || !password) return fail(41001, '请输入用户名和密码');
    if (isLocked(lockKey)) {
      return fail(42900, '失败次数过多，请 10 分钟后再试', 429);
    }

    // 接口限流（市面常见频率，DB 流水计数——多实例安全）。
    // ★ 注意：Node 侧 x-forwarded-for 是 EdgeOne 出口代理 IP（会在代理池多个 IP 间交替），
    //   不是真实客户端 IP——因此防撞库按"账号"维度计数（撞库的本质即按账号爆破），
    //   IP 维度阈值放宽（出口池稀释），仅作辅助。
    const fa = await query(
      'SELECT COUNT(*) n FROM sys_login_log WHERE username = ? AND success = 0 AND created_at > NOW() - INTERVAL 60 SECOND',
      [username],
    );
    if (Number(fa[0].n) >= 5) return fail(42900, '该账号登录尝试过于频繁，请 1 分钟后再试', 429);
    const fi = await query(
      'SELECT COUNT(*) n FROM sys_login_log WHERE ip = ? AND success = 0 AND created_at > NOW() - INTERVAL 60 SECOND',
      [ip],
    );
    if (Number(fi[0].n) >= 60) return fail(42900, '请求过于频繁，请稍后再试', 429);

    // ★ 登录标识支持三种（2026-10-20）：用户名 / 学号工号 / 校园邮箱。
    //   真实日志显示用户会用后两者登录（`20260855`、`a2026010@keaidang.com`），
    //   而原先只查 username，于是全部以"用户名或密码错误"收场 —— 用户根本不知道错在哪。
    //   唯一性由 pickLoginRow 把关：user_no 没有唯一索引，命中多行时拒绝登录并提示用用户名。
    const candidates = await query(
      `SELECT id, username, password_hash, real_name, status, valid_until, campus_email, user_no
         FROM sys_user
        WHERE username = ? OR campus_email = ? OR (user_no <> '' AND user_no = ?)
        LIMIT 5`,
      [username, username.toLowerCase(), username],
    );
    const picked = pickLoginRow(candidates, username);
    const user = picked.row;
    if (picked.ambiguous) {
      return fail(40101, '该学号/邮箱对应多个账号，请改用用户名登录');
    }
    const valid = user && (await bcrypt.compare(password, user.password_hash));

    if (!valid) {
      recordFail(lockKey);
      await query(
        'INSERT INTO sys_login_log (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, 0)',
        [user ? user.id : null, username, ip, ua],
      );
      await alertBruteforce(username, ip);
      // 模糊提示，不暴露"用户存在与否"
      return fail(40101, '用户名或密码错误');
    }
    if (user.status !== 1) return fail(40300, '账号已被禁用，请联系管理员');
    if (user.valid_until && new Date(user.valid_until).getTime() < Date.now()) {
      return fail(40300, '账号已过有效期，请联系管理员续期');
    }

    clearFail(lockKey);
    // ★ 直接返回与 /auth/me 同构的完整用户（2026-10-12）：此前这里只返回精简 user，
    //   前端登录成功后必须再补发一次 GET /api/auth/me 才拿得到 deptName 等字段
    //   → 用户点「登录」要白等两次串行往返。字段组装与 /auth/me、/auth/refresh 同源。
    const profile = await buildSessionUser(user.id);
    if (!profile) return fail(40101, '用户名或密码错误');

    // ★ 顺带清理（5% 概率触发，自助维护表体积）：过期超 7 天的刷新令牌 + 吊销超 30 天的令牌
    if (Math.random() < 0.05) {
      try {
        await query(
          `DELETE FROM sys_refresh_token
            WHERE (expires_at < NOW() - INTERVAL 7 DAY)
               OR (revoked = 1 AND created_at < NOW() - INTERVAL 30 DAY)`,
        );
      } catch { /* 清理失败不影响登录 */ }
    }

    const accessToken = signAccessToken(profile.user, profile.roles);
    const refreshToken = newRefreshToken();
    await saveRefreshToken(user.id, refreshToken);
    await query('UPDATE sys_user SET last_login_at = NOW() WHERE id = ?', [user.id]);
    await query(
      'INSERT INTO sys_login_log (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, 1)',
      [user.id, username, ip, ua],
    );

    return ok({
      accessToken,
      refreshToken,
      expiresIn: 2 * 60 * 60,
      user: profile.user,
    });
  } catch (e) {
    return jsonError(e);
  }
}
