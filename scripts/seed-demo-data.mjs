// scripts/seed-demo-data.mjs —— 演示数据补齐（毕设用）
//
// ── 为什么需要它（2026-10-10 实测发现）─────────────────────────────────
// 调研线上库发现：选课记录 2015 条里**只有 1 条录了分数**，请假单/报修单各只有 2 条，
// 借阅仅 4 条。也就是说「绩点最差的学生」「哪个班请假最多」这类**问数问题根本无法回答** ——
// 不是查询能力不行，是**没有数据可查**。
//
// ── 设计原则 ──────────────────────────────────────────────────────────
// 1. **幂等**：可重复执行，已存在的记录不重复插入；支持 --reset 清掉本脚本造的数据后重建。
// 2. **不破坏现有数据**：只补 edu_elect 的 NULL 成绩，不改已有分数；
//    新增单据时避开已有记录（按业务唯一特征去重）。
// 3. **可验证的极值**：刻意造出"全优学生""全挂学生""请假最多班级"，让每个排名类问题
//    都有**唯一正确答案**，评估脚本才能断言到具体是谁/哪个班，而不是只能断言"返回了数据"。
// 4. **分布像真实**：分数按正态分布（多数 70~85），不均匀随机 —— 均匀随机会让"最差学生"
//    有十几个人并列，排名问题无法验证。
// 5. **不造脏数据**：所有外键值都取自库内真实存在的 id；枚举值严格取自代码里的白名单。
//
// ── 用法 ──────────────────────────────────────────────────────────────
//   node scripts/seed-demo-data.mjs           # 补齐（幂等）
//   node scripts/seed-demo-data.mjs --reset   # 先删本脚本造的数据再重建
//   node scripts/seed-demo-data.mjs --dry    # 只看统计，不写库
//
// ── 执行纪律（HANDOVER §6）───────────────────────────────────────────
// 结尾必须 process.exit(0)：mysql2 连接池持有 handle，不显式退出进程不会结束，
// 配合管道输出时会被杀且缓冲全丢（曾踩过）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const RESET = args.has('--reset');
const REDO_GRADES = args.has('--redo-grades');
// --fix-elect：一次性修复入口 —— 把当前学期被误标成「已出成绩」的选课记录恢复为「在选」。
// 刻意做成**显式参数**而不是默认行为：将来真的录入了本学期成绩后，重跑脚本不该把它们清掉。
const FIX_ELECT = args.has('--fix-elect');

// ── 确定性随机（mulberry32）──────────────────────────────────────────
// 不用 Math.random：脚本必须可复现 —— 同一条命令跑两次得到同样的数据，
// 否则"可验证的极值"和评估断言都会失效。
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261010);
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

/** 正态分布（Box-Muller），均值 mu、标准差 sigma，钳制到 [lo, hi] */
function gauss(mu, sigma, lo, hi, round = 1) {
  const u = Math.max(1e-9, rand());
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const val = mu + z * sigma;
  const clamped = Math.min(hi, Math.max(lo, val));
  return round === 1 ? Math.round(clamped * 10) / 10 : Math.round(clamped);
}

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const conn = await mysql.createConnection({
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 4000),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME || 'zhihui_campus',
  ssl: { rejectUnauthorized: true },
});

const log = (...a) => console.log(...a);

/** 批量插入分批（TiDB 单批不宜过大） */
/**
 * 批量插入。
 * ★ 必须用 `VALUES ?` 配**二维数组**（且 `?` 后面不能再加括号）。
 *   写成 `VALUES (?)` + 二维数组会展开成 `VALUES (...), (...)`，语法错；
 *   写成 `VALUES ?` + 一维数组会展开成 `VALUES 1, 2, 3`，也是语法错（2026-10-10 踩过，
 *   报错指向第 2 行第 21 列，很难一眼看出是占位符用法问题）。
 */
async function insertBatch(sql, rows, size = 200) {
  let n = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const [r] = await conn.query(sql, [chunk]);
    n += r.affectedRows || 0;
  }
  return n;
}

const TERM = '2026-2027-1';
// 历史学期：成绩/绩点数据挂在这里（与当前学期严格分开，理由见下方长注释）
const TERM_HISTORY = '2025-2026-1';

// ============================================================
// 1. 历史学期成绩 + 当前学期选课状态修复
// ============================================================
// ★★ 2026-10-10 事故记录（改这里之前务必读完）★★
//
// 原实现：给**当前学期**（2026-2027-1）的选课记录直接写分数、并把 status 改成 2。
// 用户实测反馈：「选课了 前端不显示选课 但是数据库确实有 为何会这样 以前不会的」。
// 实测证据（working/probe-elect3.mjs）：
//     edu_class.enrolled 合计 2012（真实已选人数），
//     而 edu_elect 里 status=1（在选）只剩 1 条、status=2（已出成绩）有 2015 条；
//     逐个班对照：enrolled=60 的班，elect 记录里"在选" 0 条、"已出成绩" 60 条。
//
// 后果：选课页判断「我是否选了这门课」用的是 `edu_elect.status = 1`（见 api/edu/course.js
//   的 mine 子查询），记录被改成 2 之后**所有课都显示"选课"按钮** ——
//   学生既看不到自己选了什么，也无法退课（drop 要求 status=1）；成绩页则把
//   还没上完的本学期课程当成了"已修完"。
//
// 根因是**学期语义被压平**：当前学期「在选」与往年学期「已出成绩」是两种不同学期的
//   记录，不能塞进同一行。所以本文件现在严格遵守：
//     · 当前学期：只允许 status=1（在选）、score 为 NULL
//     · 历史学期：独立的教务班 + 选课记录，status=2（已出成绩）+ 分数
//   另注意 edu_elect 的唯一键是 (class_id, student_id)（不含 term），
//   所以历史成绩**必须**指向历史学期的教学班，不能复用当前学期的班。

/** 演示用的等级换算（口径与 lib/edu-stats.js 的 gradeOf 一致） */
const gradeOfDemo = (v) => (v >= 90 ? '优秀' : v >= 80 ? '良好' : v >= 70 ? '中等' : v >= 60 ? '及格' : '不及格');

/**
 * 一次性修复：把当前学期被误标成「已出成绩」的记录恢复为「在选」。
 * 只在带 `--fix-elect` 时执行（真实出成绩后不应再跑）。
 */
async function restoreCurrentTermElect() {
  const [r0] = await conn.query('SELECT COUNT(*) AS n FROM edu_elect WHERE term = ? AND status = 2', [TERM]);
  const n = Number(r0[0]?.n || 0);
  log(`  当前学期状态修复：${n} 条「已出成绩」→「在选」（同时清空分数）`);
  if (DRY || !n) return { restored: 0 };
  await conn.query(
    'UPDATE edu_elect SET score = NULL, grade = NULL, status = 1 WHERE term = ? AND status = 2',
    [TERM],
  );
  return { restored: n };
}

/**
 * 历史学期成绩：造「往年已修完的课程 + 分数」。
 *
 * 分数策略（延续"可验证极值"的设计，别改成分档之外的随机）：
 *   档 A「全优」3 人    → 85~96，绩点 3.8~4.0
 *   档 B「偏弱」5 人    → 58~72（刻意**不**大量挂科：绩点口径里不及格不计入分母，
 *                         大量挂科会让分母极小 → 多人并列 1.00，"谁最差"变成多解）
 *   档 C「中等」其余    → 正态 N(78, 9)
 * 每个学生修 5~7 门；确定性随机（固定种子），同命令跑两次结果一致，极值才可复现。
 */
async function seedHistoryGrades() {
  // ---- 1) 历史学期教学班（幂等：已存在则复用）----
  const readHClasses = () =>
    conn.query(
      `SELECT c.id, c.course_id, co.name AS course_name, co.credit
         FROM edu_class c JOIN edu_course co ON co.id = c.course_id
        WHERE c.term = ? ORDER BY c.course_id, c.id`,
      [TERM_HISTORY],
    );

  let [hclasses] = await readHClasses();

  if (!hclasses.length && !DRY) {
    // 以当前学期每门课的第一个班为模板（教师/时间/教室沿用，数据自洽，不凭空造）
    const [tpl] = await conn.query(
      `SELECT c.course_id, c.teacher_id, c.week_day, c.section, c.classroom
         FROM edu_class c JOIN edu_course co ON co.id = c.course_id
        WHERE c.term = ? AND co.status = 1
        ORDER BY c.course_id, c.id`,
      [TERM],
    );
    const seen = new Set();
    const rows = [];
    for (const t of tpl) {
      if (seen.has(t.course_id)) continue; // 每门课一个历史班
      seen.add(t.course_id);
      // status=0：历史学期已结束，**绝不能出现在选课目录里**（否则又会出现"能选已修完的课"）
      rows.push([t.course_id, t.teacher_id, TERM_HISTORY, 60, 0, t.week_day, t.section, t.classroom, 0]);
    }
    if (rows.length) {
      await insertBatch(
        'INSERT INTO edu_class (course_id, teacher_id, term, capacity, enrolled, week_day, section, classroom, status) VALUES ?',
        rows,
      );
      log(`  历史学期教学班：新建 ${rows.length} 个（term=${TERM_HISTORY}、status=0 不参与选课）`);
    }
    [hclasses] = await readHClasses();
  }

  if (!hclasses.length) {
    log('  历史学期成绩：没有可用的历史教学班，跳过');
    return { inserted: 0 };
  }

  // ---- 2) 已有数据则跳过（--redo-grades 时先清空重建）----
  const [r0] = await conn.query('SELECT COUNT(*) AS n FROM edu_elect WHERE term = ?', [TERM_HISTORY]);
  const have = Number(r0[0]?.n || 0);
  if (have > 0) {
    if (!REDO_GRADES) {
      log(`  历史学期成绩：已存在 ${have} 条，跳过（要重建加 --redo-grades）`);
      return { inserted: 0 };
    }
    if (!DRY) {
      await conn.query('DELETE FROM edu_elect WHERE term = ?', [TERM_HISTORY]);
      log(`  （--redo-grades：已清空历史学期 ${have} 条成绩，重建中）`);
    }
  }

  // ---- 3) 分档：按 id 排序取前 3 全优、后 5 偏弱（确定性，不用随机）----
  const [students] = await conn.query(
    `SELECT DISTINCT u.id
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code = 'student' AND u.status = 1
      ORDER BY u.id`,
  );
  const ids = students.map((x) => Number(x.id));
  if (!ids.length) {
    log('  历史学期成绩：没有在册学生，跳过');
    return { inserted: 0 };
  }
  const bestIds = new Set(ids.slice(0, 3));
  const worstList = ids.slice(-5);
  const worstIds = new Set(worstList);
  // ★ 其中**只有一人**是「全科压线」：所有及格课都落在 60~68 → 加权绩点恰好 1.00。
  //   为什么必须唯一：绩点是"及格课"的加权平均，下限就是 1.00；若多人并列最低，
  //   「绩点最差的学生」就有多个答案，评估脚本只能断言"返回了数据"而无法断言
  //   "返回的是对的那个"（2026-10-10 实测踩过：随机正态会偶然产出并列）。
  const floorId = worstList[worstList.length - 1];

  const rows = [];
  let over60 = 0;
  let below60 = 0;
  for (const sid of ids) {
    const n = 5 + Math.floor(rand() * 3); // 每生 5~7 门
    // Fisher–Yates 洗牌（用同一确定性随机源），保证"选哪几门"可复现
    const pool = hclasses.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let gen;
    let boostFirst = false;
    if (bestIds.has(sid)) gen = () => gauss(92, 3.5, 85, 96);
    else if (sid === floorId) gen = () => gauss(64, 2, 60, 68);
    else if (worstIds.has(sid)) {
      // 其余偏弱档也压线，但**刻意把第一门课提到 70~74** → 绩点严格大于 1.00
      gen = () => gauss(64, 2, 60, 68);
      boostFirst = true;
    } else {
      // 中等档：常规课 70~94（绩点 ≥ 2.0，不可能掉到 1.00），
      // 另给 4% 一门挂科（52~59）——挂科**不计入绩点分母**，只影响平均分与不及格率，
      // 所以既能造出"不及格率"这个指标，又不会破坏绩点的唯一性。
      gen = () => (rand() < 0.04 ? gauss(56, 1.5, 52, 59) : gauss(80, 7, 70, 94));
    }

    for (const [i, c] of pool.slice(0, n).entries()) {
      const score = i === 0 && boostFirst ? gauss(72, 1.5, 70, 74) : gen();
      if (score >= 60) over60 += 1;
      else below60 += 1;
      rows.push([c.id, sid, TERM_HISTORY, 2, score, gradeOfDemo(score)]);
    }
  }

  log(`  历史学期成绩：${rows.length} 条 / ${ids.length} 名学生（每人 5~7 门）`);
  log(`     及格 ${over60} 条 · 不及格 ${below60} 条（不及格占比 ${((below60 / rows.length) * 100).toFixed(1)}%）`);
  log(`     全优档 ${bestIds.size} 人（${[...bestIds].join(',')}）· 偏弱档 ${worstIds.size} 人（${[...worstIds].join(',')}）`);

  if (DRY) return { inserted: 0, planned: rows.length };

  const inserted = await insertBatch(
    'INSERT INTO edu_elect (class_id, student_id, term, status, score, grade) VALUES ?',
    rows,
  );
  // enrolled 与实际选课数对齐：避免出现"名额 0/60 却有 50 条选课记录"这种自相矛盾
  await conn.query(
    `UPDATE edu_class c
        SET c.enrolled = (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status = 2)
      WHERE c.term = ?`,
    [TERM_HISTORY],
  );
  return { inserted };
}

// ============================================================
// 2. 请假单：造到约 120 条，近 90 天，各班数量差异化
// ============================================================
// 差异化是刻意的：让"哪个班请假最多"有唯一答案（软件工程 2602 班最多），
// 否则并列第一无法验证。
const LEAVE_TARGET = 120;
const LEAVE_TYPES = ['事假', '病假', '其他'];
const LEAVE_REASONS = {
  事假: ['家中有事', '参加校外竞赛', '办理证件', '陪同家人就医', '短期实习面试'],
  病假: ['发热 38.5℃，需居家休息', '肠胃炎就医', '扭伤脚踝需静养', '过敏复诊', '感冒咳嗽，医生建议休息'],
  其他: ['参加校园招聘活动', '家中事务需要处理', '因交通延误无法返校', '其他个人原因'],
};

async function seedLeaves() {
  const [[{ n: have }]] = await conn.query('SELECT COUNT(*) AS n FROM af_leave');
  const need = Math.max(0, LEAVE_TARGET - Number(have));
  log(`  请假单：现有 ${have} 条，目标 ${LEAVE_TARGET} 条，需新增 ${need} 条`);
  if (!need) return { inserted: 0 };

  const [users] = await conn.query(
    `SELECT u.id, u.dept_id, c.name AS class_name
       FROM sys_user u LEFT JOIN sys_class c ON c.id = u.class_id
      WHERE u.status = 1 AND u.class_id IS NOT NULL
      ORDER BY u.id`,
  );
  if (!users.length) {
    log('     ⚠ 没有可用学生，跳过');
    return { inserted: 0 };
  }

  // 按班级分组 + 刻意权重：软件工程 2602 班权重最高（→ 请假最多，有唯一答案）
  const weightOf = (name) => {
    if (!name) return 1;
    if (name.includes('软件工程 2602')) return 12; // 刻意最多
    if (name.includes('计算机 2603')) return 6;
    if (name.includes('经管 2602')) return 5;
    if (name.includes('机械 2602')) return 4;
    if (name.includes('外语 2602')) return 3;
    return randInt(1, 4);
  };
  const bag = [];
  for (const u of users) {
    const w = weightOf(u.class_name);
    for (let k = 0; k < w; k += 1) bag.push(u);
  }

  const now = new Date();
  const rows = [];
  for (let i = 0; i < need; i += 1) {
    const u = pick(bag);
    const type = pick(LEAVE_TYPES);
    // 近 90 天内的工作日
    const daysAgo = randInt(0, 89);
    const start = new Date(now.getTime() - daysAgo * 86400000);
    start.setUTCHours(0, 0, 0, 0);
    const days = randInt(1, 5);
    const end = new Date(start.getTime() + (days - 1) * 86400000);
    end.setUTCHours(9, 0, 0, 0);
    // 状态分布：已销假 45% / 已批准 25% / 审批中 22% / 已驳回 8%
    const r = rand();
    const status = r < 0.45 ? 4 : r < 0.7 ? 2 : r < 0.92 ? 1 : 3;
    const fmt = (d) =>
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ` +
      `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
    rows.push([
      u.id,
      u.dept_id,
      type,
      pick(LEAVE_REASONS[type]),
      fmt(start),
      fmt(end),
      status,
      status === 4 ? fmt(new Date(end.getTime() + 86400000)) : null, // 已销假有销假时间
      fmt(new Date(start.getTime() - randInt(1, 5) * 86400000)), // created_at
    ]);
  }

  if (DRY) return { inserted: 0, planned: need };
  const n = await insertBatch(
    `INSERT INTO af_leave (student_id, dept_id, type, reason, start_at, end_at, status, back_at, created_at)
     VALUES ?`,
    rows,
  );
  log(`     已新增 ${n} 条`);
  return { inserted: n };
}

// ============================================================
// 3. 报修工单：造到约 80 条，四态齐全
// ============================================================
const REPAIR_TARGET = 80;
const REPAIR_CATS = ['水电', '家具', '网络', '门锁', '其他'];
const REPAIR_DESC = {
  水电: ['洗手间水龙头持续漏水', '宿舍空调不制冷', '走廊灯闪烁', '卫生间下水道堵塞', '饮水机不出水'],
  家具: ['上床梯子松动', '书桌抽屉滑轨损坏', '椅子腿断裂', '衣柜门合不上'],
  网络: ['寝室网口无法联网', '校园网频繁掉线', 'WiFi 信号极弱', '网线接口损坏'],
  门锁: ['宿舍门锁卡住无法反锁', '钥匙孔损坏', '窗户锁扣松动'],
  其他: ['垃圾桶破损', '走廊照明感应灯失灵', '饮水区地面积水'],
};
const LOCATIONS = ['1 号楼 301', '2 号楼 405', '3 号楼 208', '5 号楼 502', '实验楼 B102', '图书馆三楼自习区'];

async function seedRepairs() {
  const [[{ n: have }]] = await conn.query('SELECT COUNT(*) AS n FROM af_repair');
  const need = Math.max(0, REPAIR_TARGET - Number(have));
  log(`  报修单：现有 ${have} 条，目标 ${REPAIR_TARGET} 条，需新增 ${need} 条`);
  if (!need) return { inserted: 0 };

  const [users] = await conn.query(
    `SELECT u.id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code = 'student' AND u.status = 1 ORDER BY u.id`,
  );
  const [handlers] = await conn.query(
    `SELECT DISTINCT u.id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code IN ('counselor', 'admin') AND u.status = 1 ORDER BY u.id`,
  );
  if (!users.length) return { inserted: 0 };

  const now = Date.now();
  const fmt = (d) => {
    const x = new Date(d);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')} ` +
      `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}:${String(x.getUTCSeconds()).padStart(2, '0')}`;
  };

  const rows = [];
  for (let i = 0; i < need; i += 1) {
    const cat = pick(REPAIR_CATS);
    // 状态分布：已完成 45% / 处理中 20% / 待受理 25% / 无法处理 10%
    const r = rand();
    const status = r < 0.45 ? 2 : r < 0.65 ? 1 : r < 0.9 ? 0 : 3;
    const created = now - randInt(0, 60) * 86400000;
    const updated = status === 0 ? created : created + randInt(1, 48) * 3600000;
    rows.push([
      pick(users).id,
      pick(LOCATIONS),
      cat,
      pick(REPAIR_DESC[cat]),
      `138${String(randInt(10000000, 99999999)).slice(0, 8)}`,
      status,
      status === 0 || status === 1 ? null : pick(handlers).id, // handler_id 可为 NULL（唯一可空的列）
      status === 2 ? '已修复并验收通过' : status === 3 ? '需更换整体部件，已转供应商' : '',
      fmt(created),
      fmt(Math.min(updated, now)),
      // ai_triage 是 NOT NULL（schema-012 加的），用空串表示"尚未分诊"，让 C8 有活可干。
      // 传 NULL 会报 "Column 'ai_triage' cannot be null"（2026-10-10 踩过）。
      '',
    ]);
  }

  if (DRY) return { inserted: 0, planned: need };
  const n = await insertBatch(
    `INSERT INTO af_repair (user_id, location, category, description, contact, status, handler_id, remark, created_at, updated_at, ai_triage)
     VALUES ?`,
    rows,
  );
  log(`     已新增 ${n} 条`);
  return { inserted: n };
}

// ============================================================
// 4. 图书借阅：造到约 150 条，含逾期未还
// ============================================================
const LOAN_TARGET = 150;

async function seedLoans() {
  const [[{ n: have }]] = await conn.query('SELECT COUNT(*) AS n FROM lib_loan');
  const need = Math.max(0, LOAN_TARGET - Number(have));
  log(`  借阅单：现有 ${have} 条，目标 ${LOAN_TARGET} 条，需新增 ${need} 条`);
  if (!need) return { inserted: 0 };

  const [books] = await conn.query('SELECT id FROM lib_book WHERE available_copies > 0 ORDER BY id LIMIT 200');
  const [users] = await conn.query(
    `SELECT DISTINCT u.id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code = 'student' AND u.status = 1 ORDER BY u.id`,
  );
  if (!books.length || !users.length) {
    log('     ⚠ 无可用图书或学生，跳过');
    return { inserted: 0 };
  }

  const now = Date.now();
  const fmt = (d) => {
    const x = new Date(d);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')} ` +
      `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}:${String(x.getUTCSeconds()).padStart(2, '0')}`;
  };

  const rows = [];
  const used = new Set();
  for (let i = 0; i < need; i += 1) {
    const bookId = pick(books).id;
    const userId = pick(users).id;
    const key = `${bookId}:${userId}`;
    if (used.has(key)) continue; // 同一本书不能同时借给同一人两次（未还的）
    used.add(key);
    const borrowed = now - randInt(1, 120) * 86400000;
    const due = borrowed + 30 * 86400000;
    // 状态分布：已归还 70% / 借出中 20%（含逾期未还）/ 逾期归还 10%
    const r = rand();
    const overdue = due < now;
    let status;
    if (r < 0.7) status = overdue && rand() < 0.3 ? 2 : 1; // 已归还（其中一部分是逾期归还）
    else status = 0; // 借出中（其中一部分已逾期 → 逾期未还）
    rows.push([
      bookId,
      userId,
      status,
      fmt(borrowed),
      fmt(due),
      status === 1 || status === 2 ? fmt(due + randInt(1, 10) * 86400000) : null,
    ]);
  }

  if (DRY) return { inserted: 0, planned: need };
  const n = await insertBatch(
    'INSERT INTO lib_loan (book_id, user_id, status, borrowed_at, due_at, returned_at) VALUES ?',
    rows,
  );
  // 学期语义自检：当前学期只允许「在选」，成绩必须挂历史学期
  const [[{ curGraded }]] = await conn.query(
    "SELECT COUNT(*) AS curGraded FROM edu_elect WHERE term = ? AND status <> 1",
    [TERM],
  );
  const [[{ histGraded }]] = await conn.query(
    "SELECT COUNT(*) AS histGraded FROM edu_elect WHERE term = ? AND status = 2",
    [TERM_HISTORY],
  );
  log(`  当前学期「已出成绩」记录：${curGraded} 条（必须为 0）${curGraded > 0 ? '  ✗ 语义被破坏，跑 --fix-elect 修复' : '  OK'}`);
  log(`  历史学期（${TERM_HISTORY}）已出成绩：${histGraded} 条`);

  const [[{ overdueOpen }]] = await conn.query(
    'SELECT COUNT(*) AS overdueOpen FROM lib_loan WHERE status = 0 AND due_at < NOW()',
  );
  await conn.query(
    'UPDATE lib_book b SET b.available_copies = b.total_copies - (SELECT COUNT(*) FROM lib_loan l WHERE l.book_id = b.id AND l.returned_at IS NULL)',
  );
  log(`     已新增 ${n} 条（含逾期未还 ${overdueOpen} 条），已同步可借库存`);
  return { inserted: n };
}

// ============================================================
// 5. 论坛主题：补到约 80 条，含待复核与违规各若干
// ============================================================
const THREAD_TARGET = 80;
const THREAD_TITLES = [
  '有没有一起去看秋季展会的', '图书馆占座提醒', '食堂三楼新菜尝鲜', '二手教材转让',
  '校园网突然变慢求助', '英语角活动招募', '篮球场约球', '考研资料分享',
  '宿舍空调不制冷谁来修', '关于早八的一点建议', '社团招新现场记录', '丢失一串钥匙求线索',
];
const THREAD_BODIES = [
  '有一起的吗？顺路可以一起走，约个时间。', '早上占座后离开 请帮忙看一下，桌上放了书。',
  '新出的红烧肉不错，推荐。', '高等数学教材低价出，只用过一学期。',
  '最近晚上网速特别慢，有人一样吗？', '每周三下午在图书馆西厅，想练口语的来。',
  '周末篮球场缺人，欢迎来玩。', '整理了一份资料，有需要的评论区留言。',
];

async function seedThreads() {
  const [[{ n: have }]] = await conn.query('SELECT COUNT(*) AS n FROM forum_thread');
  const need = Math.max(0, THREAD_TARGET - Number(have));
  log(`  论坛主题：现有 ${have} 条，目标 ${THREAD_TARGET} 条，需新增 ${need} 条`);
  if (!need) return { inserted: 0 };

  const [boards] = await conn.query('SELECT id FROM forum_board WHERE status = 1 ORDER BY id');
  const [users] = await conn.query(
    `SELECT DISTINCT u.id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      WHERE r.code = 'student' AND u.status = 1 ORDER BY u.id`,
  );
  if (!boards.length || !users.length) return { inserted: 0 };

  const now = Date.now();
  const fmt = (d) => {
    const x = new Date(d);
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')} ` +
      `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}:${String(x.getUTCSeconds()).padStart(2, '0')}`;
  };

  // ★ 列名与顺序严格按 lib/services/forum.js 的 INSERT 走（2026-10-10 核对 schema-013 的库内结构：
  //   author_id 而非 user_id；is_trade/item_name/contact 独立成列，不是 price/images 那一套）。
  //   images 与 NOT NULL 的 varchar 列一律给 ''（NULL 会报 ER_BAD_NULL_ERROR）。
  const rows = [];
  for (let i = 0; i < need; i += 1) {
    const created = now - randInt(0, 45) * 86400000;
    const review = rand() < 0.15 ? 1 : 0; // 留一部分给 C2 审核队列
    const titleBase = pick(THREAD_TITLES);
    rows.push([
      pick(boards).id,
      pick(users).id,
      `${titleBase}${i >= THREAD_TITLES.length ? `（${Math.floor(i / THREAD_TITLES.length) + 1}）` : ''}`.slice(0, 60),
      pick(THREAD_BODIES),
      '', // images
      0, // is_trade
      '', // item_name
      '', // contact
      rand() < 0.1 ? 1 : 0, // pinned
      0, // locked
      1, // status=1 正常
      0, // reply_count
      review,
      fmt(created),
      fmt(created), // last_reply_at
    ]);
  }

  if (DRY) return { inserted: 0, planned: need };
  const n = await insertBatch(
    `INSERT INTO forum_thread
      (board_id, author_id, title, content, images, is_trade, item_name, contact,
       pinned, locked, status, reply_count, review_status, created_at, last_reply_at)
     VALUES ?`,
    rows,
  );
  log(`     已新增 ${n} 条`);
  return { inserted: n };
}

// ============================================================
// --reset：删除本脚本造的数据
// ============================================================
// 识别依据（不误删手工造的）：
//   · 成绩：status=2 且 grade 非空但 created_at 早于脚本首跑 —— 简化为"score 非空且非原始 id 区间"
//   · 单据：reason 含本脚本特征词 或 id 超出原始最大值
// 简化策略：记录 id > 各表"首次执行时的最大 id"即为脚本所造。用 sys_config 打标记存基准。
const MARK_KEY = 'demo.data.baseline';

async function readBaseline() {
  const [r] = await conn.query('SELECT cfg_value FROM sys_config WHERE cfg_key = ?', [MARK_KEY]);
  if (r.length) return JSON.parse(r[0].cfg_value);
  // 首次运行：记录当前各表最大 id 作为基准
  const baseline = {};
  for (const t of ['af_leave', 'af_repair', 'lib_loan', 'forum_thread']) {
    const [[r2]] = await conn.query(`SELECT COALESCE(MAX(id),0) AS m FROM ${t}`);
    baseline[t] = Number(r2.m);
  }
  await conn.query(
    `INSERT INTO sys_config (cfg_key, cfg_value, remark) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value)`,
    [MARK_KEY, JSON.stringify(baseline), '演示数据基线 id（seed-demo-data.mjs --reset 用，勿手工改）'],
  );
  log(`  已记录基线 id：${JSON.stringify(baseline)}`);
  return baseline;
}

async function resetDemoData() {
  const [r] = await conn.query('SELECT cfg_value FROM sys_config WHERE cfg_key = ?', [MARK_KEY]);
  if (!r.length) {
    log('  ⚠ 没有基线记录，无法安全 --reset（首次运行前请先不带 --reset 执行一次）');
    return;
  }
  const b = JSON.parse(r[0].cfg_value);
  for (const t of ['af_leave', 'af_repair', 'lib_loan', 'forum_thread']) {
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM ${t} WHERE id > ?`, [b[t]]);
    log(`  清理 ${t}：删除 ${n} 条（id > ${b[t]}）`);
    if (!DRY && Number(n) > 0) await conn.query(`DELETE FROM ${t} WHERE id > ?`, [b[t]]);
  }
  log('  清理完成');
}

// ============================================================
// 主流程
// ============================================================
log('=== 演示数据补齐 ===');
log(DRY ? '（--dry 模式，不写库）' : '');

if (RESET && !DRY) await resetDemoData();
await readBaseline();

// 先把 enrolled 与选课记录对齐 —— 它就是"已选人数"，两者必须相等。
// 为什么放在最前面：造任何数据之前先校准基线，后续的"班内已选 vs 在选记录数"才有可比性。
if (!DRY) {
  const [al] = await conn.query(
    `UPDATE edu_class c
        SET c.enrolled = (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status = 1)
      WHERE c.term = ?
        AND c.enrolled <> (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status = 1)`,
    [TERM],
  );
  if (al.affectedRows) log(`  名额对齐：修正 ${al.affectedRows} 个教学班的 enrolled（已选人数与选课记录数不一致）`);
}

if (FIX_ELECT) {
  const fix = await restoreCurrentTermElect();
  if (fix.restored) log(`  → 已恢复 ${fix.restored} 条为「在选」\n`);
}

const g = await seedHistoryGrades();
const l = await seedLeaves();
const r = await seedRepairs();
const bk = await seedLoans();
const th = await seedThreads();

log('\n=== 结果汇总 ===');
log(`  成绩   ${DRY ? `计划新增 ${g.planned || 0} 条` : `新增 ${g.inserted} 条`}（历史学期 ${TERM_HISTORY}）`);
log(`  请假   新增 ${l.inserted} 条`);
log(`  报修   新增 ${r.inserted} 条`);
log(`  借阅   新增 ${bk.inserted} 条`);
log(`  论坛   新增 ${th.inserted} 条`);

if (!DRY) {
  log('\n=== 关键验证（可写入评估断言的确定性答案）===');
  const [[{ totalStudents }]] = await conn.query(
    `SELECT COUNT(DISTINCT student_id) AS totalStudents FROM edu_elect WHERE score IS NOT NULL`,
  );
  log(`  已录成绩的学生数：${totalStudents}`);

  const [[{ failRate }]] = await conn.query(
    `SELECT ROUND(SUM(CASE WHEN score < 60 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS failRate
       FROM edu_elect WHERE score IS NOT NULL`,
  );
  log(`  整体不及格率：${failRate}%`);

  // ★ 绩点口径必须与 lib/edu-stats.js 完全一致：
  //     gpa = Σ(绩点 × 学分) / Σ(及格课学分)，且**不及格不计入分母**。
  //   之前这里漏了学分权重、且把不及格也算进分母 → 5 名偏弱学生并列 1.00，
  //   "谁最差"变成多解，评估无法断言（2026-10-10 实测发现）。
  //   凡是涉及绩点的统计（含后续的通用查询实体），都必须 join edu_class 取学分。
  const [worst] = await conn.query(
    `SELECT u.real_name, u.username,
            ROUND(SUM(CASE WHEN e.score >= 90 THEN 4.0 WHEN e.score >= 80 THEN 3.0
                           WHEN e.score >= 70 THEN 2.0 WHEN e.score >= 60 THEN 1.0 ELSE 0 END * co.credit)
                  / SUM(CASE WHEN e.score >= 60 THEN co.credit ELSE 0 END), 2) AS 绩点,
            ROUND(AVG(e.score), 2) AS 平均分,
            SUM(CASE WHEN e.score < 60 THEN 1 ELSE 0 END) AS 不及格门数
       FROM edu_elect e
       JOIN sys_user u ON u.id = e.student_id
       JOIN edu_class c ON c.id = e.class_id
       JOIN edu_course co ON co.id = c.course_id
      WHERE e.score IS NOT NULL AND e.status = 2
      GROUP BY e.student_id, u.real_name, u.username
     HAVING SUM(CASE WHEN e.score >= 60 THEN co.credit ELSE 0 END) > 0
      ORDER BY 绩点 ASC, 平均分 ASC LIMIT 5`,
  );
  log('  绩点最低的 5 名学生（口径与 lib/edu-stats.js 一致：不及格不计入分母）：');
  console.table(worst);

  const [topLeave] = await conn.query(
    `SELECT cl.name AS 班级, d.name AS 院系, COUNT(*) AS 请假单数
       FROM af_leave l JOIN sys_user u ON u.id = l.student_id
       LEFT JOIN sys_class cl ON cl.id = u.class_id
       LEFT JOIN sys_department d ON d.id = cl.dept_id
      WHERE l.created_at > NOW() - INTERVAL 90 DAY
      GROUP BY cl.id, cl.name, d.name ORDER BY 请假单数 DESC LIMIT 5`,
  );
  log('  近 90 天请假最多的班级（应是 软件工程 2602 班）：');
  console.table(topLeave);

  const [[{ overdueOpen }]] = await conn.query('SELECT COUNT(*) AS overdueOpen FROM lib_loan WHERE status = 0 AND due_at < NOW()');
  log(`  逾期未还：${overdueOpen} 条`);
}

await conn.end();
process.exit(0);
