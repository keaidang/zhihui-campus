// node-functions/lib/auth.js — JWT 双令牌与刷新令牌轮换
// 安全设计:
//  - 访问令牌: JWT HS256, 2 小时, 载荷只放 id/username/roles
//  - 刷新令牌: 48 字节随机数, 数据库只存 SHA-256 哈希, 7 天有效
//  - 轮换: 每次刷新作废旧令牌签发新令牌 (检测重放: 旧令牌被复用则吊销该用户全部会话)
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from './db.js';

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
  // 传 Date 对象：由连接池按 timezone('+08:00') 统一序列化/反序列化。
  // 勿改回 toISOString() 字符串——UTC 墙钟 + 池时区解读会造成 8 小时偏移
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
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

/** 原子轮换（事务版，配合瞬时错误重试）：旧版"作废旧令牌+另插新令牌"两步分离，
 *  中间撞上 TiDB 瞬时 500 会导致旧令牌已作废、新令牌未落库 → 客户端刷新令牌
 *  永久失效，F5 必跳登录页（甚至触发重放保护吊销全部会话）。
 *  现改为同一行原位换 hash：任一步失败整体回滚，旧令牌保持有效、客户端可直接重试。 */
export async function rotateRefreshTokenAtomic(token) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
  return withTransaction(async (conn) => {
    const hash = sha256(token);
    const [rows] = await conn.query(
      'SELECT id, user_id, expires_at, revoked FROM sys_refresh_token WHERE token_hash = ?',
      [hash],
    );
    const row = rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.revoked) {
      await conn.query('UPDATE sys_refresh_token SET revoked = 1 WHERE user_id = ?', [row.user_id]);
      return { ok: false, reason: 'replayed' };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    const next = newRefreshToken();
    await conn.query(
      'UPDATE sys_refresh_token SET token_hash = ?, expires_at = ? WHERE id = ?',
      [sha256(next), expiresAt, row.id],
    );
    return { ok: true, userId: row.user_id, nextToken: next };
  });
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

/** 注册频控（实例级内存版：每 IP 每小时最多 5 次，防脚本批量注册） */
const regMap = new Map(); // ip -> { count, windowStart }
const REG_MAX = 5;
const REG_WINDOW_MS = 60 * 60 * 1000;

export function registerAllowed(ip) {
  const rec = regMap.get(ip);
  if (!rec || Date.now() - rec.windowStart > REG_WINDOW_MS) return true;
  return rec.count < REG_MAX;
}

export function registerRecord(ip) {
  const rec = regMap.get(ip);
  if (!rec || Date.now() - rec.windowStart > REG_WINDOW_MS) {
    regMap.set(ip, { count: 1, windowStart: Date.now() });
  } else {
    rec.count += 1;
  }
}

/** 通用接口限流（实例级内存版，固定窗口计数；多实例下为尽力而为）
 *  频率取市面常见值：登录防撞库按 IP+账号 5/min、IP 全局 30/min；
 *  刷新 30/min；注册/发码 5/hour；忘记密码 3/hour。
 *  返回 true=放行，false=超限。内存超 1 万键自动清窗，防泄漏。 */
const rlMap = new Map(); // bucket -> Map(ident -> { win, count })
const RL_MAP_MAX = 10000;

export function rateLimit(bucket, ident, limit, windowSec) {
  const now = Date.now();
  const win = Math.floor(now / (windowSec * 1000));
  let m = rlMap.get(bucket);
  if (!m) { m = new Map(); rlMap.set(bucket, m); }
  const key = `${ident}_${win}`;
  const rec = m.get(key);
  if (!rec) {
    if (m.size > RL_MAP_MAX) rlMap.set(bucket, new Map()); // 旧窗口整批丢弃
    m.set(key, { count: 1 });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count += 1;
  return true;
}
