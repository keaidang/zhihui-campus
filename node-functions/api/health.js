// GET /api/health — 公开健康检查（含数据库连通性）
import { getPool } from '../lib/db.js';
import { ok, jsonError, preflight } from '../lib/http.js';

export { preflight as onRequestOptions };

export async function onRequestGet() {
  try {
    const [rows] = await getPool().query('SELECT 1 AS ping');
    return ok({
      db: rows[0]?.ping === 1 ? 'up' : 'unknown',
      // 运行时诊断（只报布尔，不泄密）：JWT 密钥是否已注入函数环境
      jwtConfigured: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16),
      protocol: 'text-query', // 标记当前 db.js 版本（文本协议），用于核对函数部署
      time: new Date().toISOString(),
    });
  } catch (e) {
    return jsonError(e);
  }
}
