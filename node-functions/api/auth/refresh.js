// POST /api/auth/refresh — 刷新访问令牌（轮换刷新令牌）
import { ok, fail, jsonError, readBody } from '../../lib/http.js';
import { signAccessToken, rotateRefreshTokenAtomic } from '../../lib/auth.js';
import { buildSessionUser } from '../../lib/user-profile.js';
import { preflight } from '../../lib/http.js';

export { preflight as onRequestOptions };

export async function onRequestPost(context) {
  try {
    const body = await readBody(context.request);
    const refreshToken = String(body.refreshToken || '');
    if (!refreshToken) return fail(40100, '缺少刷新令牌', 401);
    // 注：刷新端点不做频控——须持有有效刷新令牌（7 天一次性轮换 + 重放检测），
    // 滥用面等于令牌本身；内存限流在多实例下无效（见 HANDOVER 铁律 #23/#24），不加假保障

    // 原子轮换（事务+瞬时重试）：失败即回滚，旧令牌仍有效，客户端可重试
    const result = await rotateRefreshTokenAtomic(refreshToken);
    if (!result.ok) {
      const msg = { not_found: '刷新令牌无效', expired: '登录已过期，请重新登录', replayed: '检测到异常会话，请重新登录' }[result.reason];
      return fail(40100, msg || '刷新失败', 401);
    }

    // ★ 返回与 GET /api/auth/me 同构的完整用户（2026-10-12）。
    //   为什么关键：客户端恢复会话原本是 refresh → me **两次串行往返**（单次 2~3 秒），
    //   首屏「白屏」的时间一半来自这里。refresh 本来就要取用户行，改为直接返回完整
    //   user 后，客户端一次往返即可拿到可直接渲染的对象（deptName/avatarUrl/... 齐全），
    //   stores/auth.js 里那次多余的 /auth/me 随之取消。
    //   字段组装与 /auth/login、/auth/me 共用 lib/user-profile.js，杜绝字段漂移。
    const profile = await buildSessionUser(result.userId);
    if (!profile || profile.status !== 1) return fail(40300, '账号不可用', 403);
    if (profile.validUntil && new Date(profile.validUntil).getTime() < Date.now()) {
      return fail(40300, '账号已过有效期，请联系管理员续期', 403);
    }

    return ok({
      accessToken: signAccessToken(profile.user, profile.roles),
      refreshToken: result.nextToken,
      expiresIn: 2 * 60 * 60,
      user: profile.user,
    });
  } catch (e) {
    return jsonError(e);
  }
}
