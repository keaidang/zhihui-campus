// edge-functions/api/gw/[[default]].js — 边缘安全网关（云边协同的"边缘计算"承担者）
// 职责：①IP/账号 限流（KV 固定窗口计数，超限 429 不回源）②访问令牌黑名单（登出/禁用/重置密码后立即失效）
// ③通过则原样回源转发到 Node Functions（/api/gw/<rest> → /api/<rest>，该路径不匹配任何 edge 路由，无回环）
// 设计边界：KV 60s 最终一致 → 限流为"单边缘节点精确、全局尽力"；KV 故障时 fail-open（可用性优先）
// KV key 规范：仅字母数字下划线、无 TTL → 窗口号编进键名，过期键由 sweep 兜底清理
const BUCKETS = {
  // 桶代码: [上限, 窗口秒]（市面常见频率：登录防撞库按 IP+账号 5/min、IP 全局 30/min；
  // 注册/发码 5/hour；刷新 30/min；忘记密码 3/hour；常规业务 120/min 容忍 NAT 教室场景）
  ln: [5, 60],     // login_name：IP+用户名
  li: [30, 60],    // login_ip：IP 全局
  rf: [30, 60],    // refresh
  rg: [5, 3600],   // register / send-code / prefix-check
  fg: [3, 3600],   // forgot（忘记密码发码/重置）
  gn: [120, 60],   // general：其余业务请求
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS },
});

const safeKey = (s) => String(s).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64);

/** 固定窗口计数：返回 true=放行，false=超限。KV 异常一律放行（fail-open）。键名 rl_<桶>_<窗口>_<标识> */
async function allow(kv, code, ident) {
  const [limit, winSec] = BUCKETS[code];
  const win = Math.floor(Date.now() / 1000 / winSec);
  const key = `rl_${code}_${win}_${ident}`;
  try {
    const cur = Number((await kv.get(key)) || 0);
    if (cur >= limit) return false;
    await kv.put(key, String(cur + 1));
    return true;
  } catch {
    return true;
  }
}

/** JWT payload 解码（不验签——验签在回源 Node 侧做，这里只取 sub/iat 做黑名单比对） */
function jwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function sha256hex16(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 黑名单检查：单令牌吊销（bl_）+ 用户级吊销（blu_，禁用/重置密码后其全部在途令牌失效） */
async function blacklisted(kv, authz) {
  if (!authz) return false;
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length > 1024) return false;
  try {
    const h = await sha256hex16(token);
    const exp = Number((await kv.get(`bl_${h}`)) || 0);
    if (exp > Math.floor(Date.now() / 1000)) return true;
    const payload = jwtPayload(token);
    if (payload && payload.sub) {
      const until = Number((await kv.get(`blu_${safeKey(payload.sub)}`)) || 0);
      if (until && Number(payload.iat || 0) <= until) return true;
    }
  } catch { /* KV 异常放行，由回源侧兜底 */ }
  return false;
}

/** 过期限流键/黑名单清理（waitUntil 后台执行，随机触发控制 KV list 开销） */
async function sweep(kv) {
  if (Math.random() >= 0.1) return;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const page = await kv.list({ prefix: 'rl_', limit: 256 });
    for (const { key } of page.keys || []) {
      // rl_<桶代码>_<窗口号>_<标识>：桶代码与窗口号均不含下划线，第三段起是标识
      const parts = key.split('_');
      const code = parts[1];
      const win = Number(parts[2]);
      const winSec = BUCKETS[code] ? BUCKETS[code][1] : 0;
      if (winSec && nowSec - win * winSec > 2 * winSec) await kv.delete(key);
    }
    const bl = await kv.list({ prefix: 'bl_', limit: 256 });
    for (const { key } of bl.keys || []) {
      const v = Number((await kv.get(key)) || 0);
      if (v && v < nowSec - 86400) await kv.delete(key);
    }
  } catch { /* 清理失败忽略 */ }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequest(context) {
  const { request, waitUntil } = context;
  const kv = globalThis.zhihuicampus;
  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/gw\//, '').replace(/\/+$/, '');
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('eo-connecting-ip') || 'unknown';

  // ── 1. 限流分桶 ──
  if (kv && request.method !== 'OPTIONS') {
    let ok = true;
    if (rest === 'auth/login' && request.method === 'POST') {
      let uname = '';
      try { uname = safeKey(((await request.clone().json()) || {}).username || ''); } catch { /* body 缺失时只按 IP 桶 */ }
      if (uname) ok = await allow(kv, 'ln', `${ip}_${uname}`);
      if (ok) ok = await allow(kv, 'li', ip);
    } else if (rest.startsWith('auth/register')) {
      ok = await allow(kv, 'rg', ip);
    } else if (rest.startsWith('auth/password')) {
      ok = await allow(kv, 'fg', ip);
    } else if (rest === 'auth/refresh') {
      ok = await allow(kv, 'rf', ip);
    } else {
      ok = await allow(kv, 'gn', ip);
    }
    if (!ok) {
      return json({ code: 42900, message: '请求过于频繁，请稍后再试' }, 429);
    }
  }

  // ── 2. 令牌黑名单 ──
  const authz = request.headers.get('authorization') || '';
  if (kv && authz && (await blacklisted(kv, authz))) {
    return json({ code: 40103, message: '登录状态已失效，请重新登录' }, 401);
  }

  // ── 3. 回源转发到 Node Functions ──
  // ★ 关键平台行为：同域 fetch 子请求走"节点缓存→静态源站"（不进函数路由，会拿到 SPA index.html）；
  //   跨域 fetch 则重新进入目标域的完整函数路由 → /api/* 在目标域只匹配 Node Functions。
  //   故转发目标取"另一个域名"（本项目双域名：campus.keaidang.com ↔ c.9o.pw），可用 env GW_ORIGIN 覆盖。
  const ORIGINS = { 'campus.keaidang.com': 'https://c.9o.pw', 'c.9o.pw': 'https://campus.keaidang.com' };
  let upstreamBase = (context.env && context.env.GW_ORIGIN) || ORIGINS[url.hostname] || 'https://c.9o.pw';
  if (new URL(upstreamBase).hostname === url.hostname) {
    // 无可用对端域名：放行会拿到 SPA，不如直接 502 快速失败
    return json({ code: 50000, message: 'gateway upstream unavailable' }, 502);
  }
  const target = new URL(upstreamBase + '/api/' + rest + url.search);
  const fwd = new Request(target, request);
  fwd.headers.delete('host');
  const upstream = await fetch(fwd);
  const res = new Response(upstream.body, upstream);
  res.headers.set('access-control-allow-origin', '*');
  res.headers.set('x-gw-live', '1');
  res.headers.set('x-gw-upstream', `${upstream.status} ${upstream.headers.get('content-type') || ''}`);
  if (kv) waitUntil(sweep(kv));
  return res;
}
