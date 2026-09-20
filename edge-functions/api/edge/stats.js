// edge-functions/api/edge/stats.js — 边缘原生演示端点：站点访问统计（KV 计数）
// 为什么放边缘：纯计数无 DB 依赖、无强一致要求（KV 60s 最终一致可容忍），
// 边缘节点毫秒级响应且不回源 —— 这是"轻活给边缘"分工铁律的落地样板。
// GET  /api/edge/stats        自增全站 PV 并返回 { pv, today, ts }
// GET  /api/edge/stats?reset=ping  健康探测（不自增，返回当前值）
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,OPTIONS' };

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const kv = globalThis.zhihuicampus;
  if (!kv) {
    return new Response(JSON.stringify({ code: 50001, message: 'KV unavailable' }), {
      status: 500, headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS },
    });
  }
  const url = new URL(context.request.url);
  const readOnly = url.searchParams.get('probe') === '1';
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    let pv = Number((await kv.get('stat_pv_total')) || 0);
    let today = Number((await kv.get(`stat_pv_${day}`)) || 0);
    if (!readOnly) {
      pv += 1;
      today += 1;
      await kv.put('stat_pv_total', String(pv));
      await kv.put(`stat_pv_${day}`, String(today));
    }
    return new Response(JSON.stringify({
      code: 0, message: 'ok',
      data: { pv, today, ts: new Date().toISOString(), runtime: 'edge-function+kv' },
    }), { status: 200, headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS } });
  } catch (e) {
    return new Response(JSON.stringify({ code: 50001, message: 'KV error: ' + e.message }), {
      status: 500, headers: { 'content-type': 'application/json; charset=UTF-8', ...CORS },
    });
  }
}
