// node-functions/lib/auth.js — JWT 双令牌与刷新令牌轮换
// 安全设计:
//  - 访问令牌: JWT HS256, 2 小时, 载荷只放 id/username/roles
//  - 刷新令牌: 48 字节随机数, 数据库只存 SHA-256 哈希, 7 天有效
//  - 轮换: 每次刷新作废旧令牌签发新令牌 (检测重放: 旧令牌被复用则吊销该用户全部会话)
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from './db.js';

const ACCESS_TTL_SEC = 2 * 60 * 60;      // 2h
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60; // 7d

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET 未配置或过弱');
  return s;
}

export function signAccessToken(user, roles) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, roles },
    jwtSecret(),
    { expiresIn: ACCESS_TTL_SEC, algorithm: 'HS256' },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
}

export function newRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function saveRefreshToken(userId, token) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  await query(
    'INSERT INTO sys_refresh_token (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, sha256(token), expiresAt],
  );
}

/** 校验并轮换刷新令牌；返回 user_id。检测到重放则吊销该用户全部令牌。 */
export async function rotateRefreshToken(token) {
  const hash = sha256(token);
  const rows = await query(
    'SELECT id, user_id, expires_at, revoked FROM sys_refresh_token WHERE token_hash = ?',
    [hash],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revoked) {
    // 重放攻击特征: 已轮换的令牌再次出现 → 吊销该用户全部会话
    await query('UPDATE sys_refresh_token SET revoked = 1 WHERE user_id = ?', [row.user_id]);
    return { ok: false, reason: 'replayed' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  await query('UPDATE sys_refresh_token SET revoked = 1 WHERE id = ?', [row.id]);
  return { ok: true, userId: row.user_id };
}

export async function revokeRefreshToken(token) {
  await query('UPDATE sys_refresh_token SET revoked = 1 WHERE token_hash = ?', [sha256(token)]);
}

export const ACCESS_TTL = ACCESS_TTL_SEC;
export const REFRESH_TTL = REFRESH_TTL_SEC;

/** 登录失败锁定（实例级内存版；多实例下为尽力而为，后续可升级 KV/数据库版） */
const failMap = new Map(); // key -> { count, until }
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;

export function isLocked(key) {
  const rec = failMap.get(key);
  if (!rec) return false;
  if (Date.now() > rec.until) { failMap.delete(key); return false; }
  return rec.count >= MAX_FAILS;
}

export function recordFail(key) {
  const rec = failMap.get(key) || { count: 0, until: Date.now() + LOCK_MS };
  rec.count += 1;
  rec.until = Date.now() + LOCK_MS;
  failMap.set(key, rec);
}

export function clearFail(key) {
  failMap.delete(key);
}
