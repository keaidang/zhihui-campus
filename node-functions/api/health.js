// GET /api/health — 公开健康检查（含数据库连通性）
import { getPool } from '../lib/db.js';
import { ok, jsonError } from '../lib/http.js';

export async function onRequestGet() {
  try {
    const [rows] = await getPool().query('SELECT 1 AS ping');
    return ok({ db: rows[0]?.ping === 1 ? 'up' : 'unknown', time: new Date().toISOString() });
  } catch (e) {
    return jsonError(e);
  }
}
