// scripts/ai-eval.mjs — AI 效果评估跑分（本地执行，结果落库）
//
// 为什么跑分放脚本而不是接口（详见 api/ai/eval.js 顶部注释）：
//   一轮完整评估要调 30 次模型，按实测 3~4 秒/次是 90~120 秒，远超边缘函数单次执行预算。
//   本地脚本没有这个限制，而且能一边跑一边把进度打出来。
//
// 跑的是**线上同一条判定链路**（lib/ai-eval.js 里直接调 triageRepair / reviewContent /
// pickTemplate / buildKnowledgeContext），不是复制出来的第二套实现 —— 这点很重要，
// 否则量出来的数字不能代表系统真实表现。
//
// 用法：
//   node scripts/ai-eval.mjs                   跑全部场景（用库内全部启用用例）
//   node scripts/ai-eval.mjs --scene qa        只跑某个场景（qa / triage / review / insight）
//   node scripts/ai-eval.mjs --scene triage --limit 3   小样本快速验证（省钱）
//
// 前置：triage / review 场景需要先在【AI 管理控制台 → 功能开关】开启对应能力。
//       脚本会检测并如实提示，不会自动改开关（评估不该悄悄改变系统状态）。
//
// ⚠ 结尾必须 process.exit(0)：mysql2 连接池会让事件循环保持活跃，进程不退出就会
//   被外层超时杀掉，而 stdout 在非 tty 下是块缓冲 —— 输出会全丢，看起来像"卡死"。
//   （2026-10-09 踩实，见 HANDOVER §6 脚本执行纪律）
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 先把 .env 灌进 process.env —— lib/db.js 与 lib/ai.js 都从这里读
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const argv = process.argv.slice(2);
const only = argv.includes('--scene') ? argv[argv.indexOf('--scene') + 1] : null;
const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) || 0 : 0;

// 动态 import：必须在 process.env 就绪之后（模块顶层就会读 env）
const { SCENES, runScene, falsePositiveRate, violationRecall, caseStats } = await import(
  pathToFileURL(path.join(root, 'node-functions/lib/ai-eval.js')).href
);

// 评估用的 actor：直接用 admin（问数场景需要 leader/admin 角色；其余场景只看 userId）
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: +process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: true },
  connectTimeout: 20000,
});
const [adminRows] = await conn.query(
  `SELECT u.id FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id
    WHERE r.code = 'admin' AND u.status = 1 LIMIT 1`,
);
await conn.end();
const adminId = adminRows[0]?.id;
if (!adminId) {
  console.error('✗ 找不到启用状态的 admin 账号，无法解析问数权限');
  process.exit(1);
}
const actor = { userId: adminId, roles: ['admin'], deptId: null, ip: 'script' };

const stats = await caseStats();
console.log('==============================================');
console.log('  智汇校园 · AI 效果评估');
console.log('==============================================');
console.log(`管理员账号：id=${adminId}`);
console.log('用例规模：');
for (const [s, n] of Object.entries(stats.byScene)) console.log(`  ${s.padEnd(9)} ${n} 条`);
console.log(`  合计 ${stats.total} 条`);
if (limit) console.log(`\n⚠ 本次为小样本模式：每场景最多 ${limit} 条`);
console.log('');

const targets = only ? SCENES.filter((s) => s.key === only) : SCENES;
if (!targets.length) {
  console.error(`✗ 未知场景：${only}（可选：${SCENES.map((s) => s.key).join(' / ')}）`);
  process.exit(1);
}

const summary = [];
for (const sc of targets) {
  const tag = sc.costTokens ? '耗 token' : '零 token';
  console.log(`\n──────── ${sc.label}（${sc.key}，${tag}）────────`);
  const t0 = Date.now();
  const r = await runScene(actor, sc.key, { limit });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.disabled) {
    console.log(`  ⏭ 跳过：${r.disabled}`);
    summary.push({ key: sc.key, label: sc.label, skipped: r.disabled });
    continue;
  }
  if (r.empty) {
    console.log(`  ⏭ 跳过：${r.empty}`);
    summary.push({ key: sc.key, label: sc.label, skipped: r.empty });
    continue;
  }

  for (const d of r.detail) {
    const mark = d.ok ? '✓' : '✗';
    console.log(`  ${mark} ${String(d.input).slice(0, 34)}`);
    if (!d.ok) console.log(`      期望：${d.expect}　实际：${String(d.actual).slice(0, 70)}`);
  }
  console.log(`  ── 准确率 ${(r.accuracy * 100).toFixed(1)}%（${r.passed}/${r.total}），平均 ${r.avgMs}ms，耗时 ${secs}s`);

  const row = { key: sc.key, label: sc.label, accuracy: r.accuracy, passed: r.passed, total: r.total, avgMs: r.avgMs };
  if (sc.key === 'review') {
    const fp = falsePositiveRate(r.detail);
    const vr = violationRecall(r.detail);
    if (fp) {
      console.log(`  ── 误报率 ${(fp.rate * 100).toFixed(1)}%（${fp.wrong}/${fp.total} 条正常内容被判违规/可疑）`);
      row.falsePositive = fp;
    }
    if (vr) {
      console.log(`  ── 违规检出率 ${(vr.rate * 100).toFixed(1)}%（${vr.hit}/${vr.total}）`);
      row.violationRecall = vr;
    }
  }
  summary.push(row);
}

console.log('\n==============================================');
console.log('  汇总');
console.log('==============================================');
for (const s of summary) {
  if (s.skipped) {
    console.log(`  ${String(s.label).padEnd(16)} 跳过 —— ${s.skipped}`);
    continue;
  }
  let line = `  ${String(s.label).padEnd(16)} 准确率 ${(s.accuracy * 100).toFixed(1).padStart(5)}%   ${s.passed}/${s.total}   平均 ${String(s.avgMs).padStart(5)}ms`;
  if (s.falsePositive) line += `   误报率 ${(s.falsePositive.rate * 100).toFixed(1)}%`;
  console.log(line);
}
console.log('\n结果已写入 ai_eval_run（可在【AI 管理控制台 → 效果评估】查看）\n');

process.exit(0);
