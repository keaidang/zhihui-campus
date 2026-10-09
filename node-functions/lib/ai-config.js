// node-functions/lib/ai-config.js — AI 运行时配置（sys_config 键值表）
//
// 为什么不用环境变量：环境变量改动必须重新部署才生效（铁律 #5），而需求是
// "管理员在页面上开关 AI 功能" —— 必须即时生效，因此落库。
// 读多写少 → 模块级缓存 30 秒（多实例各自缓存，最坏 30 秒延迟，可接受）。
import { query } from './db.js';
import { opLog } from './guard.js';

const CACHE_TTL = 30_000;
let cache = { at: 0, map: null };

/** 取全部配置（带缓存） */
export async function allConfig({ force = false } = {}) {
  if (!force && cache.map && Date.now() - cache.at < CACHE_TTL) return cache.map;
  const rows = await query('SELECT cfg_key, cfg_value FROM sys_config');
  const map = Object.fromEntries(rows.map((r) => [r.cfg_key, String(r.cfg_value ?? '')]));
  cache = { at: Date.now(), map };
  return map;
}

/** 失效缓存（写配置后调用；跨实例最坏仍差 30 秒） */
export function invalidateConfigCache() {
  cache = { at: 0, map: null };
}

export async function getConfig(key, fallback = '') {
  const map = await allConfig();
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

/** 开关型：'1'/'true' 视为真 */
export async function getBool(key, fallback = false) {
  const v = await getConfig(key, fallback ? '1' : '0');
  return v === '1' || String(v).toLowerCase() === 'true';
}

export async function getInt(key, fallback = 0) {
  const v = Number(await getConfig(key, String(fallback)));
  return Number.isFinite(v) ? Math.trunc(v) : fallback;
}

/** 写配置（管理端专用），并留痕 */
export async function setConfig(key, value, operatorId = 0, ip = '') {
  const k = String(key || '').trim().slice(0, 64);
  if (!k.startsWith('ai.')) throw new Error('仅允许修改 ai.* 配置');
  const v = String(value ?? '').slice(0, 1024);
  await query(
    `INSERT INTO sys_config (cfg_key, cfg_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), updated_by = VALUES(updated_by)`,
    [k, v, operatorId || null],
  );
  invalidateConfigCache();
  await opLog(operatorId, 'ai.config.set', k, v, ip);
  return { key: k, value: v };
}

/** 仅数据库内的 AI 开关快照（供 /api/ai/status 与管理页一次性返回） */
export async function aiFlags() {
  const map = await allConfig();
  return Object.fromEntries(Object.entries(map).filter(([k]) => k.startsWith('ai.')));
}
