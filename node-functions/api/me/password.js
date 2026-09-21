// /api/me/password — 登录用户自助修改【登录密码】
// POST { oldPassword, newPassword }
//
// 安全设计（改动前请读完）：
//  1. **必须验证原密码**（bcrypt.compare）——否则会话一旦被劫持，攻击者可直接改密把真实用户锁在门外；
//  2. 新密码 8~64 位且**不得与原密码相同**（规则统一取自 lib/password-rules.js）；
//  3. **改密即视为"口令可能已泄露"**：成功后吊销该用户**全部** refresh token，其他设备会话失效。
//     ⚠ access token 是 2 小时无状态 JWT，故最长 2 小时内其他设备仍可能持有有效凭证，
//     这是纯 JWT 架构的固有边界（要秒级全端失效需引入令牌版本号，当前规模不做）；
//  4. 原密码错误限流：10 分钟内 5 次（DB 流水计数，多实例安全——内存计数在多实例下会失效）；
//  5. 成功与失败都写 opLog，便于事后审计暴力尝试。
import bcrypt from 'bcryptjs';
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { checkNewPassword } from '../../lib/password-rules.js';

export { preflight as onRequestOptions };

export async function onRequestPost(context) {
  try {
    const { userId } = await requireRoles(context);
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!oldPassword || !newPassword) return fail(43700, '请填写原密码与新密码');

    const rule = checkNewPassword(oldPassword, newPassword);
    if (!rule.ok) {
      // 长度问题与"与原密码相同"用不同码，便于前端精确提示
      return fail(rule.reason.includes('相同') ? 43702 : 43701, rule.reason);
    }

    const users = await query('SELECT id, username, password_hash FROM sys_user WHERE id = ? AND status = 1', [userId]);
    if (users.length === 0) return fail(43703, '用户不存在或已被禁用');
    const u = users[0];

    // 原密码错误限流（DB 流水计数；与登录限流同一范式）
    const fails = await query(
      `SELECT COUNT(*) n FROM sys_op_log
        WHERE action = 'me.password.fail' AND operator_id = ? AND created_at > NOW() - INTERVAL 10 MINUTE`,
      [userId],
    );
    if (Number(fails[0].n) >= 5) return fail(42900, '原密码错误次数过多，请 10 分钟后再试');

    const matched = await bcrypt.compare(oldPassword, u.password_hash);
    if (!matched) {
      await opLog(userId, 'me.password.fail', `user:${userId}`, u.username, ip);
      return fail(43704, '原密码不正确');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [hash, userId]);
    // 吊销该用户全部刷新令牌：改密后其他设备必须重新登录
    await query('UPDATE sys_refresh_token SET revoked = 1 WHERE user_id = ?', [userId]);
    await opLog(userId, 'me.password', `user:${userId}`, '登录密码已修改（已吊销全部会话）', ip);

    return ok({ reLogin: true }, '密码已修改，请使用新密码重新登录');
  } catch (e) {
    return jsonError(e);
  }
}
