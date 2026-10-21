// scripts/seed-leave-week.mjs —— 近一周请假数据补齐（演示 / 简报联调用）
//
// ── 为什么需要它（2026-10-21 查实）────────────────────────────────────
// 「周运行态势简报」（api/ai/briefing.js）统计的是**近 7 日**请假单，
// 而线上库近 7 日一条新单都没有（最后一单停在 10-11），于是简报里
// 请假四个数字恒为 0 —— AI 只能对着全 0 写综述，演示时看不出任何东西。
//
// ── 设计原则 ────────────────────────────────────────────────────────
// 1. **按真实业务形状写入**：不只是插 af_leave，还同时建 flow_instance + flow_node，
//    与 lib/services/leave.js#applyLeave 完全一致。否则这些单子点"审批通过"会失败，
//    也会被 integrity-check 当成脏数据。
// 2. **可精确回滚**：每个插入的 id 都记进 manifest（默认 scripts/.out/），
//    `--rollback=<manifest>` 按 id 删除，不依赖文本匹配，不会误伤真实数据。
// 3. **只用真实存在的外键**：学生、院系、辅导员全部取自库内现有人；
//    请假类型严格取自代码白名单（事假/病假/其他）。
// 4. **分布像真实**：四种状态按 40/30/15/15 分布，created_at 均匀散布在近 N 天，
//    start_at 晚于申请时间、end_at 晚于 start_at，销假单必有 back_at。
// 5. **必须显式确认**：不带 --yes 只做预演（打印计划不写库）。
//
// ── 用法 ────────────────────────────────────────────────────────────
//   node scripts/seed-leave-week.mjs                    # 预演（不写库）
//   node scripts/seed-leave-week.mjs --yes              # 写入 16 条近 7 日数据
//   node scripts/seed-leave-week.mjs --yes --days=7 --count=20
//   node scripts/seed-leave-week.mjs --rollback=scripts/.out/seed-leave-week-xxx.json
//
//   本机证书链缺 Let's Encrypt 新根（Root YE）时可加 --insecure-ssl 跳过校验，
//   仅限本机临时使用，**不要**把这个开关带进 CI 或生产。
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

for (const line of (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const has = (name) => argv.includes(`--${name}`);

const DAYS = Math.min(30, Math.max(1, Number(arg('days', 7))));
const COUNT = Math.min(40, Math.max(1, Number(arg('count', 16))));
const CONFIRM = has('yes');
const ROLLBACK = arg('rollback', '');
const INSECURE = has('insecure-ssl');
const MANIFEST_DIR = path.join('scripts', '.out');

const STATUS_PLAN = [
  { status: 1, node: 0, inst: 1, share: 0.4 }, // 审批中
  { status: 2, node: 1, inst: 2, share: 0.3 }, // 已批准
  { status: 3, node: 2, inst: 3, share: 0.15 }, // 已驳回
  { status: 4, node: 1, inst: 4, share: 0.15 }, // 已销假
];

const REASONS = {
  事假: ['家中有急事需回家处理，已与班长报备', '参加直系亲属婚礼，往返需一天', '办理身份证换证手续', '陪同家人就医'],
  病假: ['感冒发烧 38.5 度，校医院建议休息', '急性肠胃炎，已就诊并附诊断证明', '运动扭伤脚踝，需卧床休养', '牙科复诊，需拔除阻生齿'],
  其他: ['代表学院参加省级学科竞赛集训', '校艺术团演出联调彩排', '参加校运动会志愿服务', '学院安排的实验室值守'],
};
const TYPES = Object.keys(REASONS);

const dsn = {
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 20000,
  ssl: INSECURE ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
  timezone: 'Z',
};

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

const conn = await mysql.createConnection(dsn);

/** 回滚模式：按 manifest 里的 id 精确删除 */
if (ROLLBACK) {
  const man = JSON.parse(fs.readFileSync(ROLLBACK, 'utf8'));
  const leaveIds = (man.leaves || []).map((x) => x.leaveId);
  const instIds = (man.leaves || []).map((x) => x.instanceId);
  if (!leaveIds.length) {
    console.log('manifest 里没有记录，无需回滚');
    await conn.end();
    process.exit(0);
  }
  await conn.beginTransaction();
  await conn.query(`DELETE FROM flow_node WHERE instance_id IN (${instIds.map(() => '?').join(',')})`, instIds);
  await conn.query(`DELETE FROM flow_instance WHERE id IN (${instIds.map(() => '?').join(',')})`, instIds);
  const [r] = await conn.query(`DELETE FROM af_leave WHERE id IN (${leaveIds.map(() => '?').join(',')})`, leaveIds);
  await conn.commit();
  console.log(`已回滚：请假单 ${r.affectedRows} 条（流程实例 ${instIds.length} 个）`);
  await conn.end();
  process.exit(0);
}

// ── 1. 取真实学生 / 院系 / 辅导员 ─────────────────────────────────────
const [students] = await conn.query(
  `SELECT u.id, u.real_name, u.dept_id
     FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student'
    WHERE u.status = 1 AND u.dept_id IS NOT NULL
    ORDER BY RAND()
    LIMIT ?`,
  [COUNT],
);
if (students.length < COUNT) {
  console.log(`⚠ 可用学生只有 ${students.length} 人，按实际人数生成`);
}

const [counselors] = await conn.query(
  `SELECT u.id, u.dept_id
     FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id AND r.code = 'counselor'
    WHERE u.status = 1`,
);
const counselorOfDept = new Map();
for (const c of counselors) if (c.dept_id && !counselorOfDept.has(c.dept_id)) counselorOfDept.set(c.dept_id, c.id);
const anyCounselor = counselors[0]?.id || null;

// ── 2. 生成计划 ──────────────────────────────────────────────────────
const plan = [];
for (let i = 0; i < students.length; i += 1) {
  const s = students[i];
  // 按 share 累积决定状态，保证四种状态都有且比例接近
  const bucket = (i / students.length) % 1;
  let acc = 0;
  let picked = STATUS_PLAN[0];
  for (const p of STATUS_PLAN) {
    acc += p.share;
    if (bucket < acc) {
      picked = p;
      break;
    }
  }
  const type = TYPES[i % TYPES.length];
  const pool = REASONS[type];
  const reason = pool[i % pool.length];
  // created_at：近 DAYS 天内随机，但至少 3 小时前（留出审批时间）
  const minutesAgo = 180 + Math.floor(Math.random() * (DAYS * 24 * 60 - 180));
  const createdAt = new Date(Date.now() - minutesAgo * 60 * 1000);
  createdAt.setUTCSeconds(0, 0);
  const start = new Date(createdAt.getTime() + (2 + Math.floor(Math.random() * 20)) * 3600 * 1000);
  const end = new Date(start.getTime() + (6 + Math.floor(Math.random() * 60)) * 3600 * 1000);
  const backAt = picked.status === 4 ? new Date(end.getTime() + 6 * 3600 * 1000) : null;
  plan.push({ student: s, type, reason, picked, createdAt, start, end, backAt });
}

console.log('=== 写入计划（近 %d 天 / %d 条）===', DAYS, plan.length);
for (const p of plan) {
  console.log(
    `  ${fmt(p.createdAt)}  ${p.student.real_name.padEnd(4, '　')} ${p.type} ` +
      `/*${p.picked.status === 1 ? '审批中' : p.picked.status === 2 ? '已批准' : p.picked.status === 3 ? '已驳回' : '已销假'}*/`,
  );
}
if (!CONFIRM) {
  console.log('\n预演结束（未写库）。确认无误后加 --yes 执行。');
  await conn.end();
  process.exit(0);
}

// ── 3. 写入（单事务，任何一步失败整体回滚）────────────────────────────
const manifest = { generatedAt: new Date().toISOString(), days: DAYS, leaves: [] };
await conn.beginTransaction();
try {
  for (const p of plan) {
    const [ins] = await conn.query(
      'INSERT INTO af_leave (student_id, dept_id, type, reason, start_at, end_at, status, back_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        p.student.id,
        p.student.dept_id,
        p.type,
        p.reason,
        fmt(p.start),
        fmt(p.end),
        p.picked.status,
        p.backAt ? fmt(p.backAt) : null,
        fmt(p.createdAt),
      ],
    );
    const leaveId = ins.insertId;
    const [fi] = await conn.query(
      `INSERT INTO flow_instance (biz_type, biz_id, title, applicant_id, dept_id, status, current_node, created_at, updated_at)
       VALUES ('leave', ?, ?, ?, ?, ?, 1, ?, ?)`,
      [leaveId, `${p.type}申请`, p.student.id, p.student.dept_id, p.picked.inst, fmt(p.createdAt), fmt(p.createdAt)],
    );
    const instanceId = fi.insertId;
    const handlerId = p.picked.status === 1 ? null : counselorOfDept.get(p.student.dept_id) || anyCounselor;
    await conn.query(
      `INSERT INTO flow_node (instance_id, node_order, node_name, handler_role, handler_id, status, opinion, handled_at, created_at)
       VALUES (?, 1, '辅导员审批', 'counselor', ?, ?, ?, ?, ?)`,
      [
        instanceId,
        handlerId,
        p.picked.node,
        p.picked.status === 1 ? '' : p.picked.status === 3 ? '材料不全，请补充证明后重新提交' : '情况属实，同意',
        p.picked.status === 1 ? null : fmt(new Date(p.createdAt.getTime() + 3600 * 1000)),
        fmt(p.createdAt),
      ],
    );
    await conn.query('UPDATE af_leave SET instance_id = ? WHERE id = ?', [instanceId, leaveId]);
    manifest.leaves.push({ leaveId, instanceId, studentId: p.student.id, status: p.picked.status });
  }
  await conn.commit();
} catch (e) {
  await conn.rollback();
  console.error('写入失败，已回滚：', e.code, e.message);
  await conn.end();
  process.exit(1);
}

fs.mkdirSync(MANIFEST_DIR, { recursive: true });
const file = path.join(MANIFEST_DIR, `seed-leave-week-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
console.log(`\n已写入 ${manifest.leaves.length} 条；回滚清单：${file}`);
console.log(`回滚命令：node scripts/seed-leave-week.mjs --rollback=${file}`);

// ── 4. 自检：确认写入结果与简报口径一致 ───────────────────────────────
const [dist] = await conn.query(
  'SELECT status, COUNT(*) n FROM af_leave WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) GROUP BY status ORDER BY status',
  [DAYS],
);
console.log('近 %d 天状态分布：', DAYS, dist.map((x) => `${x.status}:${x.n}`).join(' '));
await conn.end();
