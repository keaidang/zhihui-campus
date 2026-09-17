// node-functions/lib/db.js — TiDB 连接池（全项目唯一出口）
// 线上走系统信任库（Node 内置信任库含 ISRG Root X1，无需显式 CA）；
// 本地开发可通过 DB_CA_PATH 显式加载证书。
import mysql from 'mysql2/promise';
import fs from 'node:fs';

let pool = null;

export function getPool() {
  if (pool) return pool;
  const cfg = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'zhihui_campus',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_MAX || 5),
    queueLimit: 0,
    enableKeepAlive: true,
    timezone: '+08:00',
    ssl: { rejectUnauthorized: true },
  };
  if (process.env.DB_CA_CERT) {
    // 兼容：若环境变量中配置了 base64 证书，则还原 PEM
    const b64 = process.env.DB_CA_CERT.replace(/\s+/g, '');
    const pem = `-----BEGIN CERTIFICATE-----\n${(b64.match(/.{1,64}/g) || []).join('\n')}\n-----END CERTIFICATE-----`;
    cfg.ssl = { ca: pem, rejectUnauthorized: true };
  } else if (process.env.DB_CA_PATH) {
    cfg.ssl = { ca: fs.readFileSync(process.env.DB_CA_PATH), rejectUnauthorized: true };
  }
  pool = mysql.createPool(cfg);
  return pool;
}

/** 参数化查询便捷封装（强制防注入）
 *  ★ 用文本协议 query() 而非 execute()：TiDB Serverless 代理对预编译语句
 *    (COM_STMT_EXECUTE) 存在 "malform packet error" 偶发兼容问题，
 *    曾导致登录成功路径随机 500。mysql2 文本协议同样是占位符转义，防注入不变。
 *  ★ 瞬时错误自动重试一次：TiDB 免费层建连/代理偶发抖动（连接重置、坏包、
 *    连接数瞬时打满），表现为同请求随机 500——重试即可恢复。 */
const TRANSIENT = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'ERR_SOCKET_BAD_PORT',
  'ER_USER_LIMIT_REACHED',
  'ER_CON_COUNT_ERROR',
];
function isTransient(e) {
  if (!e) return false;
  if (TRANSIENT.includes(e.code)) return true;
  if (typeof e.code === 'string' && e.code.startsWith('PROTOCOL')) return true;
  const msg = String(e.message || '').toLowerCase();
  return (
    msg.includes('malform packet') ||
    msg.includes('econnreset') ||
    msg.includes('connection lost') ||
    msg.includes('handshake') ||
    msg.includes('ssl') ||
    msg.includes('timeout') ||
    msg.includes('too many connection')
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function query(sql, params = []) {
  for (let attempt = 0; ; attempt++) {
    try {
      const [rows] = await getPool().query(sql, params);
      return rows;
    } catch (e) {
      // 瞬时错误最多重试 2 次（间隔递增），仍失败则抛给上层
      if (attempt < 2 && isTransient(e)) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

/** 事务封装：fn(conn) 内用 conn.query 执行多条语句，任一失败自动回滚 */
export async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
