// node-functions/lib/db.js — TiDB 连接池（全项目唯一出口）
// 线上走系统信任库（Node 内置信任库含 ISRG Root X1，无需显式 CA）；
// 本地开发可通过 DB_CA_PATH 显式加载证书。
// ★ 另始终附带 lib/le-chain.js 里的 Let's Encrypt 中间链：边缘节点偶发只下发叶子证书，
//   缺中间链时 verify 补不全到受信任根，mysql2 会把它报成 ECONNRESET（2026-10-21 实测）。
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import tls from 'node:tls';
import { LE_EXTRA_CA } from './le-chain.js';

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
    // ★ 必须 'Z'（UTC）：TiDB 会话时区就是 UTC（@@system_time_zone='UTC'），所有 DATETIME 存 UTC 墙钟。
    //   曾误配 '+08:00' → mysql2 把 UTC 墙钟当北京墙钟解读，Date 对象整体早 8 小时，
    //   连带 JSON 输出、Node 侧过期比较、60s 频控全部偏移（2026-09-20 实测确认后修正）。
    //   展示层一律交前端 src/utils/time.js fmtTime() 转本地时区；库内时间比较一律放 SQL 侧。
    timezone: 'Z',
    ssl: { rejectUnauthorized: true },
  };
  if (process.env.DB_CA_CERT) {
    // 兼容：若环境变量中配置了 base64 证书，则还原 PEM
    const b64 = process.env.DB_CA_CERT.replace(/\s+/g, '');
    const pem = `-----BEGIN CERTIFICATE-----\n${(b64.match(/.{1,64}/g) || []).join('\n')}\n-----END CERTIFICATE-----`;
    // 显式根 + 中间链：链条能在服务端漏发中间证书时自行补全
    cfg.ssl = { ca: [pem, LE_EXTRA_CA], rejectUnauthorized: true };
  } else if (process.env.DB_CA_PATH) {
    cfg.ssl = { ca: [fs.readFileSync(process.env.DB_CA_PATH, 'utf8'), LE_EXTRA_CA], rejectUnauthorized: true };
  } else {
    // 未指定根 = 用 Node 内置根（与默认行为等价）+ 中间链。
    // 注意不能只传中间链：中间证书不是信任根，单独传会因"找不到签发者"而失败。
    cfg.ssl = { ca: [...tls.rootCertificates, LE_EXTRA_CA], rejectUnauthorized: true };
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
export function isTransient(e) {
  if (!e) return false;
  if (TRANSIENT.includes(e.code)) return true;
  if (typeof e.code === 'string' && (e.code.startsWith('PROTOCOL') || e.code.startsWith('ECONN'))) return true;
  // MySQL/TiDB 瞬时错误码：2006 服务器断开、2013 查询中失去连接、4031 等待超时
  if ([2006, 2013, 4031].includes(e.errno)) return true;
  const msg = String(e.message || '').toLowerCase();
  // ★ 只认「连接层抖动」的完整表述（2026-10-14 收窄）：
  //   旧版用 'ssl'/'timeout'/'socket'/'aborted'/'terminated' 五个**单词级**子串做匹配，
  //   会把 "SSL certificate verify failed"（配置错误，重试无意义）、
  //   "Query timeout"、"Statement aborted"、"Query terminated"（语义已完成/被中止）
  //   等**不应重试**的错误误判为瞬时——对写操作盲目重试既掩盖真实缺陷，
  //   也可能重复执行副作用，与 README「不让重试掩盖真实缺陷」的原则相悖。
  //   连接类表述（handshake / connection lost / socket hang up）仍保留完整词组。
  return (
    msg.includes('malform packet') ||
    msg.includes('econnreset') ||
    msg.includes('connection lost') ||
    msg.includes('handshake') ||
    msg.includes('ssl handshake') ||
    msg.includes('connection timeout') ||
    msg.includes('etimedout') ||
    msg.includes('too many connection') ||
    msg.includes('server has gone away') ||
    msg.includes('socket hang up') ||
    msg.includes('connection aborted') ||
    msg.includes('connection terminated')
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

/** 事务封装：fn(conn) 内用 conn.query 执行多条语句，任一失败自动回滚
 *  ★ 瞬时错误自动重试（换新连接，最多 2 次）：事务内语句此前没有 query() 的
 *    重试兜底，选课等写操作偶发 500 的主因。要求 fn 业务幂等（选课/退课满足：
 *    upsert 重激活 + 条件 UPDATE 天然可重入）；极小概率"提交成功但响应丢失"
 *    的幻影提交，重试后会以业务错误码（如 42003）而非 500 返回，可接受。 */
export async function withTransaction(fn) {
  for (let attempt = 0; ; attempt++) {
    let conn;
    try {
      conn = await getPool().getConnection();
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      if (conn) {
        try { await conn.rollback(); } catch { /* 连接已坏，忽略回滚错误 */ }
      }
      // 仅瞬时错误重试；业务错误（DUPLICATE/FULL/NOT_ENROLLED 等）直接抛出
      if (attempt < 2 && isTransient(e)) {
        await sleep(150 * (attempt + 1));
        continue;
      }
      throw e;
    } finally {
      if (conn) conn.release();
    }
  }
}
