// node-functions/lib/edgegw.js — Node → 边缘网关黑名单写入（尽力而为，失败不阻塞主流程）
// Node Functions 无 KV 权限（KV 仅边缘函数可用），吊销信息经 HTTP 调用边缘端点 /api/gw/blacklist 写入。
// 需环境变量 EDGE_GW_SECRET（与 EdgeOne Edge Functions 环境变量同配一个值）；未配置则跳过，
// 此时黑名单退化：刷新令牌 DB 吊销不受影响，访问令牌靠 2h 自然过期。
import crypto from 'node:crypto';

export function tokenHash16(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

function jwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64').toString('utf8'));
    return Number(payload.exp) || 0;
  } catch {
    return 0;
  }
}

/**
 * 写入黑名单（fire-and-forget，异常吞掉）
 * @param {Request|{url:string}} request 用于推导本站 origin
 * @param {{token?:string, userId?:number|string}} opts token=单个访问令牌；userId=用户级吊销
 */
export async function edgeBlacklist(request, { token, userId } = {}) {
  const secret = process.env.EDGE_GW_SECRET;
  if (!secret || (!token && !userId)) return;
  try {
    const origin = new URL(request.url).origin;
    const body = {};
    if (token) {
      body.tokenHash = tokenHash16(token);
      body.exp = jwtExp(token);
    }
    if (userId) body.userId = String(userId);
    if (userId) body.until = Math.floor(Date.now() / 1000);
    await fetch(`${origin}/api/gw/blacklist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gw-secret': secret },
      body: JSON.stringify(body),
      // 回源子请求 3s 超时兜底：黑名单是加速失效的辅助手段，不应拖慢主流程
      signal: AbortSignal.timeout(3000),
    });
  } catch { /* 黑名单写失败不阻塞业务：DB 吊销仍然生效 */ }
}
