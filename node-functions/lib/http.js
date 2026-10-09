// node-functions/lib/http.js — 统一响应与安全头
// 响应格式约定见 docs/API.md: { code, message, data }

// CORS：同源部署时不影响；多端独立域名（admin/m 子域）跨域调用时必需。
// 白名单通过环境变量 CORS_ORIGIN 配置（逗号分隔），未配置则放开（鉴权走 Bearer 无 Cookie，风险可控）
const allowOrigin = () => process.env.CORS_ORIGIN || '*';

// 安全响应头：导出供 SSE 等自定义响应复用（铁律 #29 —— 改一处必须想着另一处）
export const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=UTF-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': allowOrigin(),
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

/** CORS 预检：跨域场景浏览器对带 JSON/Authorization 的请求自动发起 OPTIONS */
export function preflight() {
  return new Response(null, { status: 204, headers: SECURITY_HEADERS });
}

export function ok(data = null, message = 'ok') {
  return new Response(JSON.stringify({ code: 0, message, data }), {
    status: 200,
    headers: SECURITY_HEADERS,
  });
}

export function fail(code, message, status = 400) {
  return new Response(JSON.stringify({ code, message, data: null }), {
    status,
    headers: SECURITY_HEADERS,
  });
}

/**
 * 系统异常（500）告警：按「错误码 + 分钟」去重，避免一次故障刷出几十封邮件。
 * 动态 import 规避循环依赖（http.js ← guard.js ← ai-config.js ← alert.js ← http.js）。
 */
async function alertSystem500(e) {
  try {
    const { alert } = await import('./alert.js');
    const minute = new Date().toISOString().slice(0, 16); // UTC 分钟粒度，仅作去重键
    await alert.system500({
      title: `系统异常：${String(e?.code || e?.name || 'Error')}`,
      detail: [
        `错误类型：${String(e?.name || 'Error')}`,
        `错误码：${String(e?.code ?? '-')}`,
        `信息：${String(e?.message || '').slice(0, 400)}`,
        `时间（UTC）：${minute}`,
        '',
        '该异常已落 sys_op_log(action=error.500)，可在库中检索同时段的完整上下文。',
      ].join('\n'),
      dedupeKey: `500:${String(e?.code ?? e?.name ?? 'Error')}:${minute}`,
    });
  } catch {
    /* 告警失败绝不能影响 500 响应本身 */
  }
}

/**
 * 统一错误响应。
 * ★ 为什么是 async：需要 `await` 告警邮件 —— Serverless/边缘运行时**不保证**响应返回后
 *   后台 Promise 还会跑完，fire-and-forget 会丢掉告警。告警内部带去重，且总开关默认关，
 *   因此常态下这条 await 只多一次"开关查询"，不会拖慢响应。
 */
export async function jsonError(e) {
  // 业务性错误（guard.js HttpError）按其自带 code/status 返回，不吞成 500
  if (e && typeof e.toResponse === 'function') return e.toResponse();
  console.error('[api-error]', e);
  // 错误落库（尽力而为）：边缘运行时没有日志控制台，落 sys_op_log 便于远程诊断
  import('./db.js')
    .then(({ getPool }) =>
      getPool()
        .query(
          'INSERT INTO sys_op_log (operator_id, action, target, detail) VALUES (0, ?, ?, ?)',
          ['error.500', String(e?.code || ''), String(e?.message || '').slice(0, 500)],
        )
        .catch(() => {}),
    )
    .catch(() => {});
  await alertSystem500(e);
  return fail(50000, '服务器内部错误', 500);
}

/**
 * 解析 JSON body（带大小限制防滥用）
 *
 * ★ 为什么要单独兜住"读不到 body"（2026-10-09 线上实测到的平台行为）：
 *   边缘平台偶发地会把请求体消费掉（表现为 `Body is unusable: Body has already been read`），
 *   实测概率约 15%，且**与业务耗时无关**（一个不含任何 AI 调用、毫秒级返回的请求也会中）。
 *   此前这会穿透成 50000「服务器内部错误」—— 既误导用户，也让我们误以为是自己的 bug。
 *   这里改成 **503 + 独立错误码**：
 *     · 前端 `api/request.js` 对非 GET 的 5xx 已有"自动重试一次"的逻辑 → 用户无感恢复
 *     · 错误码独立，便于在 sys_op_log 里统计平台该行为的真实频率
 *   注意：不用 import HttpError（http.js ← guard.js ← http.js 会成环），
 *   直接给 Error 挂 toResponse，jsonError 认得这个形状。
 */
export async function readBody(request, maxBytes = 16 * 1024) {
  let text;
  try {
    text = await request.text();
  } catch (e) {
    console.error('[body-unreadable]', e?.message);
    import('./db.js')
      .then(({ getPool }) =>
        getPool()
          .query('INSERT INTO sys_op_log (operator_id, action, target, detail) VALUES (0, ?, ?, ?)', [
            'error.bodyUnreadable',
            request.method || '',
            String(e?.message || '').slice(0, 200),
          ])
          .catch(() => {}),
      )
      .catch(() => {});
    const err = new Error('请求体不可读');
    err.code = 49406;
    err.status = 503;
    err.toResponse = () => fail(49406, '网络传输不完整，请重试一次', 503);
    throw err;
  }
  if (text.length > maxBytes) throw new Error('body too large');
  return text ? JSON.parse(text) : {};
}

/** 客户端真实 IP（边缘透传头优先） */
export function clientIp(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.eo?.geo?.clientIp ||
    'unknown'
  );
}
