// scripts/repair-leave-flow.mjs —— 2026-10-26 数据修复（一次性，可重复执行）
//
// ── 修什么（都是体检里查到的、不修就会一直错的东西）──────────────────
// 1. 请假单缺流程实例：283 条里 265 条 instance_id 为空（历史 seed 直插 af_leave）。
//    其中"审批中"的单子点审批时 flow_node / flow_instance 更新命中 0 行，
//    审批意见与处理人**静默丢失**。这里按状态补建实例与节点，opinion 注明是补录。
// 2. 语义矛盾：23 条"已驳回"的单子却带 back_at（销假时间）—— 只有已批准(2)才能销假，
//    这些值是 seed 直接构造出来的，清空回 NULL。
// 3. 悬空外键：sys_message.sender_id = 1（120 条）、af_repair.handler_id = 1（55 条），
//    而库里没有 id=1 的用户（真实超管是 2000001）→ 站内信发送人、报修处理人显示空。
//    改为指向真实超管；找不到超管则退化为 0 / NULL（不编造）。
// 4. 名额口径：edu_class.enrolled 统一重算为 COUNT(edu_elect.status IN (1,2))
//    （0=已退课 / 1=修读中 / 2=已出分），修掉历史学期"221 人 / 容量 60"的假名额。
//
// ── 用法 ────────────────────────────────────────────────────────────
//   node scripts/repair-leave-flow.mjs            # 预演（默认，只打印不写库）
//   node scripts/repair-leave-flow.mjs --yes      # 真正执行（单事务，失败整体回滚）
//
// 执行前会把受影响的原始行导出到 scripts/.out/repair-<时间戳>.json，便于回溯。
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { ensureLeaveFlow } from '../node-functions/lib/services/leave.js';

for (const line of (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--yes');
const INSECURE = argv.includes('--insecure-ssl');
const OUT_DIR = path.join('scripts', '.out');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 20000,
  ssl: INSECURE ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
  timezone: 'Z',
});

const one = async (sql, p = []) => {
  const [r] = await conn.query(sql, p);
  return r[0];
};
const all = async (sql, p = []) => {
  const [r] = await conn.query(sql, p);
  return r;
};

// ── 0. 现状取证 ───────────────────────────────────────────────────────
const before = {
  leaveTotal: Number((await one('SELECT COUNT(*) n FROM af_leave')).n),
  leaveNoFlow: Number((await one('SELECT COUNT(*) n FROM af_leave WHERE instance_id IS NULL')).n),
  leavePendingNoFlow: Number(
    (await one('SELECT COUNT(*) n FROM af_leave WHERE status = 1 AND instance_id IS NULL')).n,
  ),
  rejectedWithBackAt: Number(
    (await one('SELECT COUNT(*) n FROM af_leave WHERE status = 3 AND back_at IS NOT NULL')).n,
  ),
  msgSenderBad: Number(
    (await one('SELECT COUNT(*) n FROM sys_message m LEFT JOIN sys_user u ON u.id = m.sender_id WHERE m.sender_id <> 0 AND u.id IS NULL')).n,
  ),
  repairHandlerBad: Number(
    (await one('SELECT COUNT(*) n FROM af_repair r LEFT JOIN sys_user u ON u.id = r.handler_id WHERE r.handler_id IS NOT NULL AND r.handler_id <> 0 AND u.id IS NULL')).n,
  ),
  enrolledMismatch: Number(
    (await one(`SELECT COUNT(*) n FROM edu_class c
                 WHERE c.enrolled <> (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status IN (1,2))`)).n,
  ),
  overCapacity: Number((await one('SELECT COUNT(*) n FROM edu_class WHERE enrolled > capacity')).n),
};

const admin = await one('SELECT id FROM sys_user WHERE id = 2000001 LIMIT 1');
const adminId = admin ? Number(admin.id) : null;

console.log('=== 修复前 ===');
console.log(`  请假单总数 ${before.leaveTotal}，缺流程实例 ${before.leaveNoFlow}（其中待审批 ${before.leavePendingNoFlow}）`);
console.log(`  已驳回却有销假时间 ${before.rejectedWithBackAt}`);
console.log(`  站内信发送人悬空 ${before.msgSenderBad}，报修处理人悬空 ${before.repairHandlerBad}`);
console.log(`  教学班名额与选课记录不一致 ${before.enrolledMismatch}（其中超容量 ${before.overCapacity}）`);
console.log(`  超管账号 2000001：${adminId ? '存在' : '不存在（悬空外键将退化处理）'}`);

if (!CONFIRM) {
  console.log('\n预演结束（未写库）。确认后加 --yes 执行。');
  await conn.end();
  process.exit(0);
}

// ── 1. 备份受影响的行 ────────────────────────────────────────────────
const backup = {
  generatedAt: new Date().toISOString(),
  before,
  leavesNoFlow: await all(
    'SELECT id, student_id, dept_id, type, status, instance_id, back_at, created_at FROM af_leave WHERE instance_id IS NULL ORDER BY id',
  ),
  rejectedWithBackAt: await all('SELECT id, status, back_at FROM af_leave WHERE status = 3 AND back_at IS NOT NULL ORDER BY id'),
  msgBadSender: await all('SELECT id, sender_id, receiver_id, title FROM sys_message m WHERE m.sender_id <> 0 AND NOT EXISTS (SELECT 1 FROM sys_user u WHERE u.id = m.sender_id) ORDER BY id'),
  repairBadHandler: await all('SELECT id, handler_id, status FROM af_repair r WHERE r.handler_id IS NOT NULL AND r.handler_id <> 0 AND NOT EXISTS (SELECT 1 FROM sys_user u WHERE u.id = r.handler_id) ORDER BY id'),
  classesEnrolled: await all('SELECT id, term, capacity, enrolled FROM edu_class ORDER BY id'),
};
fs.mkdirSync(OUT_DIR, { recursive: true });
const backupFile = path.join(OUT_DIR, `repair-${Date.now()}.json`);
fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
console.log(`\n已备份受影响数据：${backupFile}`);

// ── 2. 单事务执行 ────────────────────────────────────────────────────
await conn.beginTransaction();
try {
  // 2.1 补建流程实例
  const noFlow = await all(
    'SELECT id, student_id, dept_id, type, status, instance_id FROM af_leave WHERE instance_id IS NULL ORDER BY id',
  );
  let filled = 0;
  for (const lv of noFlow) {
    // eslint-disable-next-line no-await-in-loop
    const id = await ensureLeaveFlow(conn, lv);
    if (id) filled += 1;
  }

  // 2.2 清掉"已驳回却有销假时间"的矛盾值
  const [fixBack] = await conn.query('UPDATE af_leave SET back_at = NULL WHERE status = 3 AND back_at IS NOT NULL');

  // 2.3 悬空外键：指向真实超管（找不到则退化）
  let msgFixed = 0;
  let repairFixed = 0;
  if (adminId) {
    const [m] = await conn.query(
      'UPDATE sys_message m SET m.sender_id = ? WHERE m.sender_id <> 0 AND NOT EXISTS (SELECT 1 FROM sys_user u WHERE u.id = m.sender_id)',
      [adminId],
    );
    msgFixed = m.affectedRows;
    const [r] = await conn.query(
      'UPDATE af_repair r SET r.handler_id = ? WHERE r.handler_id IS NOT NULL AND r.handler_id <> 0 AND NOT EXISTS (SELECT 1 FROM sys_user u WHERE u.id = r.handler_id)',
      [adminId],
    );
    repairFixed = r.affectedRows;
  } else {
    const [m] = await conn.query(
      'UPDATE sys_message m SET m.sender_id = 0 WHERE m.sender_id <> 0 AND NOT EXISTS (SELECT 1 FROM sys_user u WHERE u.id = m.sender_id)',
    );
    msgFixed = m.affectedRows;
    const [r] = await conn.query(
      'UPDATE af_repair r SET r.handler_id = NULL WHERE r.handler_id IS NOT NULL AND r.handler_id <> 0 AND NOT EXISTS (SELECT 1 FROM sys_user u WHERE u.id = r.handler_id)',
    );
    repairFixed = r.affectedRows;
  }

  // 2.4 重算名额（口径：status IN (1,2)）
  const [cap] = await conn.query(
    `UPDATE edu_class c
        SET c.enrolled = (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status IN (1, 2))`,
  );

  await conn.commit();
  console.log('\n=== 已执行 ===');
  console.log(`  补建流程实例 ${filled} 条`);
  console.log(`  清空矛盾销假时间 ${fixBack.affectedRows} 条`);
  console.log(`  站内信发送人修正 ${msgFixed} 条，报修处理人修正 ${repairFixed} 条`);
  console.log(`  教学班名额重算 ${cap.affectedRows} 条`);
} catch (e) {
  // 连接可能已被服务端断开（此时事务随连接消失自动回滚），rollback 不能再抛出来盖住真错误
  try {
    await conn.rollback();
  } catch {
    /* 已断开则忽略 */
  }
  console.error('\n执行失败，已回滚：', e.code, e.message, e.sqlMessage || '');
  try {
    await conn.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
}

// ── 3. 执行后自检 ────────────────────────────────────────────────────
const after = {
  leaveNoFlow: Number((await one('SELECT COUNT(*) n FROM af_leave WHERE instance_id IS NULL')).n),
  rejectedWithBackAt: Number((await one('SELECT COUNT(*) n FROM af_leave WHERE status = 3 AND back_at IS NOT NULL')).n),
  msgSenderBad: Number(
    (await one('SELECT COUNT(*) n FROM sys_message m LEFT JOIN sys_user u ON u.id = m.sender_id WHERE m.sender_id <> 0 AND u.id IS NULL')).n,
  ),
  repairHandlerBad: Number(
    (await one('SELECT COUNT(*) n FROM af_repair r LEFT JOIN sys_user u ON u.id = r.handler_id WHERE r.handler_id IS NOT NULL AND r.handler_id <> 0 AND u.id IS NULL')).n,
  ),
  enrolledMismatch: Number(
    (await one(`SELECT COUNT(*) n FROM edu_class c
                 WHERE c.enrolled <> (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status IN (1,2))`)).n,
  ),
  leaveFlowInstances: Number((await one("SELECT COUNT(*) n FROM flow_instance WHERE biz_type='leave'")).n),
  flowStatusMismatch: Number(
    (await one(`SELECT COUNT(*) n FROM af_leave l JOIN flow_instance fi ON fi.id = l.instance_id WHERE l.status <> fi.status`)).n,
  ),
};
console.log('\n=== 修复后自检 ===');
for (const [k, v] of Object.entries(after)) console.log(`  ${k} = ${v}`);

await conn.end();
