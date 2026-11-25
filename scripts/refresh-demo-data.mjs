// scripts/refresh-demo-data.mjs — 演示数据保鲜（只动时间，不改业务事实）
//
// 【为什么需要】
// AI 问数的统计窗口是**滚动窗口**（近 7 天 / 30 天 / 180 天），不是自然周。
// 演示用的那批请假单日期是固定的，每过一天就有几条掉出"近 7 天"，
// 于是同一个问题「哪个班请假最多」的数字会一天比一天小（实测 9 人次 → 7 人次）。
// 答辩/演示前跑一次本脚本，把整批单据整体后移，让它们重新落回窗口内。
//
// 【用法】
//   node scripts/refresh-demo-data.mjs            # 预演，只打印将要改什么
//   node scripts/refresh-demo-data.mjs --yes      # 执行
//   node scripts/refresh-demo-data.mjs --yes --days 2   # 指定后移天数（默认 3）
//
// 【只改什么】
//   只改 af_leave.created_at / start_at / end_at，以及对应 flow_instance、flow_node 的时间。
//   状态、审批意见、审批人、班级、事由一律不动 —— 业务事实不变，只是"最近发生的"。
//
// 【安全边界】
//   1. 只处理 DEMO_IDS 范围内的单据（本批演示数据），不碰真实历史数据
//   2. 全部在一个事务里，任何一步失败整体回滚
//   3. 改完打印新的窗口分布，方便核对
import fs from 'node:fs';
import mysql from 'mysql2/promise';

const DEMO_FROM = 2240236;
const DEMO_TO = 2240252;

for (const line of (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const args = process.argv.slice(2);
const DRY = !args.includes('--yes');
const daysArg = args.indexOf('--days');
const DAYS = daysArg >= 0 ? Math.max(1, Math.min(30, Number(args[daysArg + 1]) || 3)) : 3;

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // 严格证书校验在国内网络下经常被 reset（实测 ECONNRESET），这里放宽只影响传输层校验
  ssl: { rejectUnauthorized: false },
  connectTimeout: 25000,
  timezone: 'Z',
});
const q = async (sql, params = []) => (await conn.query(sql, params))[0];

const [before] = await q(
  `SELECT COUNT(*) n FROM af_leave WHERE id BETWEEN ? AND ? AND created_at > NOW() - INTERVAL 7 DAY`,
  [DEMO_FROM, DEMO_TO],
);
console.log(`演示批（id ${DEMO_FROM}~${DEMO_TO}）当前落在近 7 天窗口内：${before.n} 条`);

if (DRY) {
  console.log(`\n将把这批单据整体后移 ${DAYS} 天（含流程实例与节点时间）。`);
  console.log('预演模式，加 --yes 执行。');
  await conn.end();
  process.exit(0);
}

await conn.beginTransaction();
try {
  const [u1] = await q(
    `UPDATE af_leave SET
       created_at = DATE_ADD(created_at, INTERVAL ? DAY),
       start_at   = DATE_ADD(start_at,   INTERVAL ? DAY),
       end_at     = DATE_ADD(end_at,     INTERVAL ? DAY)
     WHERE id BETWEEN ? AND ?`,
    [DAYS, DAYS, DAYS, DEMO_FROM, DEMO_TO],
  );
  const [u2] = await q(
    `UPDATE flow_instance SET
       created_at = DATE_ADD(created_at, INTERVAL ? DAY),
       updated_at = DATE_ADD(updated_at, INTERVAL ? DAY)
     WHERE biz_type = 'leave' AND biz_id BETWEEN ? AND ?`,
    [DAYS, DAYS, DEMO_FROM, DEMO_TO],
  );
  const [u3] = await q(
    `UPDATE flow_node n JOIN flow_instance i ON i.id = n.instance_id
        SET n.created_at = DATE_ADD(n.created_at, INTERVAL ? DAY),
            n.handled_at = CASE WHEN n.handled_at IS NULL THEN NULL
                                ELSE DATE_ADD(n.handled_at, INTERVAL ? DAY) END
      WHERE i.biz_type = 'leave' AND i.biz_id BETWEEN ? AND ?`,
    [DAYS, DAYS, DEMO_FROM, DEMO_TO],
  );
  await conn.commit();
  console.log(`\n已后移 ${DAYS} 天：请假单 ${u1.affectedRows} 条 / 流程实例 ${u2.affectedRows} 条 / 节点 ${u3.affectedRows} 条`);
} catch (e) {
  await conn.rollback().catch(() => {});
  console.error('✗ 失败已回滚：', e.code || e.message);
  await conn.end();
  process.exit(1);
}

const rows = await q(
  `SELECT COALESCE(cl.name, '（未分班）') AS 班级, COUNT(*) AS 人次
     FROM af_leave l
     JOIN sys_user u ON u.id = l.student_id
     LEFT JOIN sys_class cl ON cl.id = u.class_id
    WHERE l.created_at > NOW() - INTERVAL 7 DAY
    GROUP BY cl.id, cl.name
    ORDER BY 人次 DESC`,
);
console.log('\n刷新后近 7 天各班请假：');
const total = rows.reduce((n, r) => n + Number(r.人次), 0);
for (const r of rows) console.log(`  ${String(r.班级).padEnd(18)} ${r.人次} 人次`);
console.log(`  合计 ${total} 人次 —— AI 问数应据此回答`);

await conn.end();
