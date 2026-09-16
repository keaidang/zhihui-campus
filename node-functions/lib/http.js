// node-functions/lib/http.js — 统一响应与安全头
// 响应格式约定见 docs/API.md: { code, message, data }

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=UTF-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
};

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

export function jsonError(e) {
  console.error('[api-error]', e);
  return fail(50000, '服务器内部错误', 500);
}

/** 解析 JSON body（带大小限制防滥用） */
export async function readBody(request, maxBytes = 16 * 1024) {
  const text = await request.text();
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
