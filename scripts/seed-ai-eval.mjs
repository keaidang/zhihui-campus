// scripts/seed-ai-eval.mjs — AI 效果评估用例入库（幂等）
//
// 为什么要有这份数据集（依据 docs/PERFORMANCE.md 与系里方案 §四）：
//   系里明确要求给出**量化**指标（准确率、召回率、F1、效率提升%）。
//   指标不能手写，只能跑出来 —— 但"跑"的前提是先有**标注数据**。
//   本脚本就是那份标注数据集，是评估指标的**唯一数据源**。
//
// 四条标注纪律：
//   1. **期望值必须可由程序判定**（部门名/verdict/模板 key/关键词），
//      不写"回答得好不好"这种主观标准 —— 否则无法自动跑分。
//   2. 用例取材于**真实使用场景**（学生口吻提问、真实报修描述），
//      不是为测试硬造的句子。方案要求"真实场景、真实数据"。
//   3. 每条都写 `note`（标注依据），答辩时被问到"你这个期望值谁定的、
//      凭什么"时能答上来。
//   4. 负例要留（如"食堂菜太咸"这种正常吐槽），否则只测违规样本会
//      把"误报率"这项指标测没了 —— 而误报率恰恰是审核类能力最该看的。
//
// 用法：
//   node scripts/seed-ai-eval.mjs            写入/更新（幂等）
//   node scripts/seed-ai-eval.mjs --dry      只统计不写库
//
// 场景与期望值格式（与 node-functions/api/ai/eval.js 的判定逻辑一一对应）：
//   qa       expect = 期望命中的知识库关键词（命中标题或正文即算对）
//   triage   expect = "责任部门|紧急度"（部门完全匹配 = 通过）
//   review   expect = ok | suspect | violation
//   insight  expect = 模板 key（见 lib/ai-insight.js 的 TEMPLATES）
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// ============================ 评估用例 ============================
const CASES = [
  // ---------- qa：知识问答的**检索层**（零 AI token，可高频跑） ----------
  // 判的是"该被召回的知识条目有没有被召回"，不是"回答好不好"。
  // 之所以能零成本：检索是纯本地计算（词匹配打分），不调模型。
  { scene: 'qa', input: '我想选课，怎么操作？', expect: '选课', note: '应召回选课规则条目' },
  { scene: 'qa', input: '课太满了，想退掉一门', expect: '退课', note: '口语"退掉"应命中退课条目' },
  { scene: 'qa', input: '请假要谁批准？多久出结果？', expect: '请假', note: '应召回请假审批流程' },
  { scene: 'qa', input: '宿舍灯坏了找谁修', expect: '报修', note: '口语"灯坏了"应命中报修流程' },
  { scene: 'qa', input: '图书馆能借几本书、借多久', expect: '借阅', note: '应召回图书借阅规则' },
  { scene: 'qa', input: '忘记登录密码了怎么办', expect: '密码', note: '曾漏召（关键词缺"忘记登录密码"），已补同义词，回归用例' },
  { scene: 'qa', input: '校园邮箱怎么开通', expect: '邮箱', note: '应召回校园邮箱开通流程' },
  { scene: 'qa', input: '在图书馆丢了东西去哪里找', expect: '失物|丢了东西|捡到东西', note: '应召回失物招领；多关键词是因为该条目标题写作"丢了东西/捡到东西怎么办？"' },
  { scene: 'qa', input: '在哪里查我的成绩', expect: '成绩', note: '应召回成绩查询入口' },
  { scene: 'qa', input: '宿舍是怎么分配的', expect: '宿舍', note: '应召回宿舍分配规则' },
  { scene: 'qa', input: '论坛发帖有什么要求', expect: '论坛', note: '应召回论坛发帖规范' },
  { scene: 'qa', input: '辅导员能看到别的学院的数据吗', expect: '数据', note: '应召回数据范围说明（权限类问题）' },

  // ---------- triage：报修分诊（耗 token；部门完全匹配 = 通过） ----------
  { scene: 'triage', input: '洗手间水管爆了，一直在漏水，地上全是水，止不住', expect: '后勤处水电组|urgent', note: '漏水有安全隐患，应判紧急且派水电组' },
  { scene: 'triage', input: '宿舍灯管一直闪，看着眼睛累', expect: '后勤处水电组|normal', note: '照明类归水电组，不影响安全为一般' },
  { scene: 'triage', input: '椅子腿断了，坐不了', expect: '后勤处维修组|normal', note: '家具类归维修组' },
  { scene: 'triage', input: '校园网连不上，网口指示灯不亮', expect: '网络信息中心|high', note: '网络完全不通，影响学习生活' },
  { scene: 'triage', input: '宿舍门锁被人撬了，门框上有明显划痕', expect: '保卫处|urgent', note: '涉及安全，归保卫处且紧急' },
  { scene: 'triage', input: '插座没电，可能是宿舍跳闸了', expect: '后勤处水电组|high', note: '可提示学生先查配电箱（selfService），仍派水电组' },
  { scene: 'triage', input: '床板断了，晚上没法睡', expect: '后勤处维修组|high', note: '床铺属家具，影响睡眠为较急' },
  { scene: 'triage', input: '马桶堵了，冲不下去', expect: '后勤处水电组|high', note: '给排水归水电组' },
  { scene: 'triage', input: '空调遥控器按了没反应，可能是电池没电了', expect: '后勤处维修组|low', note: '空调属电器设备，提示词分类里未单列（水电/家具/网络/安全/学工），归维修组属合理外推；紧急度应为低（疑似可自理）' },
  { scene: 'triage', input: '墙上有一条小裂缝，不影响住', expect: '后勤处维修组|low', note: '学生自述不影响使用，判 low' },

  // ---------- review：论坛内容审核（耗 token；verdict 完全匹配 = 通过） ----------
  // ★ 负例（正常内容）必须占一定比例，否则测不出"误报率"
  { scene: 'review', input: '有人今晚一起打篮球吗？体育馆三号场', expect: 'ok', note: '正常约球' },
  { scene: 'review', input: '求推荐数据结构入门教材，零基础能看懂的', expect: 'ok', note: '正常求助' },
  { scene: 'review', input: '出一辆二手自行车，九成新，300 可小刀，校内自提', expect: 'ok', note: '二手交易属正常，不是广告（判定口径明写）' },
  { scene: 'review', input: '专业代写毕业论文，包过，有意加微信 abc123456', expect: 'violation', note: '代写代考属明确违规' },
  { scene: 'review', input: '出售四六级考试答案，内部渠道，先款后发', expect: 'violation', note: '考试作弊类违规' },
  { scene: 'review', input: '刷单兼职，日入五百，加 QQ 群拉你进群', expect: 'violation', note: '刷单诈骗类违规' },
  { scene: 'review', input: '转让考研英语资料，含历年真题和手写笔记，50 元', expect: 'ok', note: '资料转让属正常，与代写不同' },
  { scene: 'review', input: '张三就是个傻逼，大家别跟他玩', expect: 'violation', note: '人身攻击属违规' },
  { scene: 'review', input: '李四的手机号是 13812345678，需要联系他的自己打', expect: 'violation', note: '泄露他人隐私属违规' },
  { scene: 'review', input: '食堂今天的菜有点咸，吐槽一下', expect: 'ok', note: '正常吐槽（不含人身攻击口径明写为 ok）' },
  { scene: 'review', input: '学生会招新，有意向的同学私信我', expect: 'ok', note: '校内正常通知' },
  { scene: 'review', input: '低价出各种证件，身份证银行卡都有，需要的联系', expect: 'violation', note: '涉证件买卖属违法内容' },

  // ---------- insight：信息问数（耗 token；模板 key 完全匹配 = 通过） ----------
  { scene: 'insight', input: '这周哪个班请假最多', expect: 'leave_top_classes', note: '班级维度排名' },
  { scene: 'insight', input: '各院系请假情况排名', expect: 'leave_dept_rank', note: '院系维度排名' },
  { scene: 'insight', input: '最近请假总览，按类型和状态看看', expect: 'leave_overview', note: '总览类' },
  { scene: 'insight', input: '哪些课选的人最多', expect: 'course_top', note: '选课规模排名（key 是 course_top，不是 elect_top）' },
  { scene: 'insight', input: '成绩等级分布情况', expect: 'score_distribution', note: '成绩分布' },
  { scene: 'insight', input: '宿舍入住率怎么样', expect: 'dorm_occupancy', note: '入住情况' },
  { scene: 'insight', input: '报修工单的处理情况', expect: 'repair_stats', note: '工单统计' },
  { scene: 'insight', input: '论坛活跃度如何', expect: 'forum_activity', note: '论坛活跃度' },
];

// ============================ 入库（幂等） ============================
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: true },
  connectTimeout: 20000,
});

// 自检一：qa 用例的期望关键词必须能命中知识库里的某条
//   否则说明**标注本身写错了**，而不是系统不准 —— 两者必须分清，
//   不然评估报告会把标注错误算成系统缺陷（2026-10-09 首轮就踩到一次）
{
  const [kbRows] = await conn.query('SELECT title, keywords FROM ai_kb WHERE status = 1');
  const kbText = kbRows.map((r) => `${r.title} ${r.keywords}`).join('\n');
  let bad = 0;
  for (const c of CASES.filter((x) => x.scene === 'qa')) {
    const kws = String(c.expect).split('|').map((x) => x.trim()).filter(Boolean);
    if (!kws.some((kw) => kbText.includes(kw))) {
      bad += 1;
      console.warn(`⚠ qa 用例期望值可疑："${c.input}" 期望「${c.expect}」—— 知识库里找不到含该关键词的条目`);
    }
  }
  if (bad) console.warn(`  （${bad} 条需核对；若确认知识库确实没有该主题，应把用例改为负例或删除）\n`);
  else console.log('✓ qa 用例期望值自检通过（关键词均能在知识库中命中）\n');
}

// 自检二：同一场景内 input 不得重复（否则 md5 幂等键会互相覆盖）
const seen = new Map();
for (const c of CASES) {
  const k = `${c.scene}|${c.input}`;
  if (seen.has(k)) {
    console.error(`✗ 用例重复：${k}（md5 幂等键会冲突，请修改其中一条的表述）`);
    await conn.end();
    process.exit(1);
  }
  seen.set(k, true);
}

const byScene = {};
for (const c of CASES) byScene[c.scene] = (byScene[c.scene] || 0) + 1;
console.log('用例分布：');
for (const [s, n] of Object.entries(byScene)) console.log(`  ${s.padEnd(9)} ${n} 条`);
console.log(`  合计 ${CASES.length} 条\n`);

if (dry) {
  console.log('（--dry 模式，未写库）');
  await conn.end();
  process.exit(0);
}

let inserted = 0;
let updated = 0;
let unchanged = 0;
for (const c of CASES) {
  const hash = md5(`${c.scene}|${c.input}`);
  const [exist] = await conn.query('SELECT id, expect, note, status FROM ai_eval_case WHERE hash = ?', [hash]);
  if (!exist.length) {
    await conn.query('INSERT INTO ai_eval_case (scene, hash, input, expect, note, status) VALUES (?, ?, ?, ?, ?, 1)', [
      c.scene,
      hash,
      c.input,
      c.expect,
      c.note || '',
    ]);
    inserted += 1;
    continue;
  }
  const cur = exist[0];
  // 内容全等则跳过写库 —— 让"幂等"这件事能被输出直接证明
  if (String(cur.expect) === c.expect && String(cur.note || '') === (c.note || '') && Number(cur.status) === 1) {
    unchanged += 1;
    continue;
  }
  await conn.query('UPDATE ai_eval_case SET expect = ?, note = ?, status = 1 WHERE id = ?', [c.expect, c.note || '', cur.id]);
  updated += 1;
}

const [rows] = await conn.query('SELECT scene, COUNT(*) AS n FROM ai_eval_case WHERE status = 1 GROUP BY scene ORDER BY scene');
console.log(`写入完成：新增 ${inserted} 条、更新 ${updated} 条、未变化 ${unchanged} 条`);
console.log('库内启用用例：');
for (const r of rows) console.log(`  ${String(r.scene).padEnd(9)} ${r.n} 条`);

await conn.end();
process.exit(0);
