// /api/blob — 图片 Blob 暂存（后续接图床只换本文件的 URL 生成）
// POST { base64, mime } → { url: '/api/blob/<token>' }   需登录；单张 ≤ 3MB
// GET  /api/blob/<token> → 图片二进制（公共可读：失物/社团/论坛页都要 <img> 直出）
import { ok, fail, jsonError, readBody } from '../lib/http.js';
import { requireAuth } from '../lib/guard.js';
import { query } from '../lib/db.js';

const MAX_BYTES = 3 * 1024 * 1024;
const MIME_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const randToken = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestPost(context) {
  try {
    const payload = requireAuth(context);
    // base64 体积约 4/3 倍，放宽到 4MB 文本 ≈ 3MB 二进制
    const body = await readBody(context.request, 4 * 1024 * 1024);
    const mime = String(body.mime || 'image/jpeg');
    if (!MIME_OK.has(mime)) return fail(47001, '仅支持 jpg/png/webp/gif 图片');
    const b64 = String(body.base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) return fail(47001, '缺少图片数据');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 0) return fail(47001, '图片数据无效');
    if (buf.length > MAX_BYTES) return fail(47002, '图片超过 3MB，请压缩后再上传');

    const token = randToken();
    await query('INSERT INTO sys_blob (token, mime, size, data, uploader_id) VALUES (?, ?, ?, ?, ?)', [
      token, mime, buf.length, buf, Number(payload.sub),
    ]);
    return ok({ url: `/api/blob/${token}`, size: buf.length });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const m = url.pathname.match(/\/api\/blob\/([a-z0-9]{16})$/i);
    if (!m) return fail(47004, '无效的图片地址', 404);
    const rows = await query('SELECT mime, data FROM sys_blob WHERE token = ?', [m[1].toLowerCase()]);
    if (rows.length === 0) return fail(47004, '图片不存在', 404);
    return new Response(rows[0].data, {
      status: 200,
      headers: {
        'Content-Type': rows[0].mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
