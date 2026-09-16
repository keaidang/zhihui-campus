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
    connectionLimit: Number(process.env.DB_POOL_MAX || 8),
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

/** 参数化查询便捷封装（强制防注入） */
export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** 事务封装：fn(conn) 内用 conn.execute 执行多条语句，任一失败自动回滚 */
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
