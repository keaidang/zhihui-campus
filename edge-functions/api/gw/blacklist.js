// edge-functions/api/gw/blacklist.js — 令牌黑名单写入端点（仅 Node Functions 内部调用）
// Node 侧在登出/管理员禁用/重置密码/忘记密码重置后调用，把吊销信息写入 KV：
//   bl_<tokenHash16> = <exp 秒>   单个访问令牌立即失效（logout）
//   blu_<userId>     = <until 秒> 用户级吊销：iat ≤ until 的全部在途令牌失效（禁用/重置密码）
// 安全：需请求头 x-gw-secret 与环境变量 EDGE_GW_SECRET 一致（Node 与 Edge 同配一个值）。
// 未配置 EDGE_GW_SECRET 时本端点拒绝写入（黑名单功能退化为仅 DB 吊销刷新令牌，访问令牌 2h 自然过期）。
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type, x-gw-secret',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const secret = context.env && context.env.EDGE_GW_SECRET;
  if (!secret || context.request.headers.get('x-gw-secret') !== secret) {
    return new Response(JSON.stringify({ code: 40301, message: 'forbidden' }), {
      status: 403, headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS },
    });
  }
  const kv = globalThis.zhihuicampus;
  if (!kv) {
    return new Response(JSON.stringify({ code: 50001, message: 'KV unavailable' }), {
      status: 500, headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS },
    });
  }
  let body;
  try { body = await context.request.json(); } catch {
    return new Response(JSON.stringify({ code: 41001, message: 'bad request' }), {
      status: 400, headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS },
    });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    if (body.tokenHash && /^[a-f0-9]{16}$/.test(body.tokenHash)) {
      const exp = Math.max(Number(body.exp) || 0, nowSec);
      await kv.put(`bl_${body.tokenHash}`, String(exp));
    }
    if (body.userId) {
      const until = Math.max(Number(body.until) || 0, nowSec);
      await kv.put(`blu_${String(body.userId).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64)}`, String(until));
    }
    return new Response(JSON.stringify({ code: 0, message: 'ok' }), {
      status: 200, headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS },
    });
  } catch (e) {
    return new Response(JSON.stringify({ code: 50001, message: 'KV write failed: ' + e.message }), {
      status: 500, headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS },
    });
  }
}
