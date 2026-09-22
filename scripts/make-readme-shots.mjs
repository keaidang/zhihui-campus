// scripts/make-readme-shots.mjs — 生成 README 用截图（线上真实环境）
//
// 用法：
//   node scripts/make-readme-shots.mjs                    # 打线上 https://c.9o.pw
//   SHOT_BASE=http://127.0.0.1:4178 node scripts/make-readme-shots.mjs   # 打本地预览
//   SHOT_ONLY=dashboard node scripts/make-readme-shots.mjs # 只重截指定几张（逗号分隔）
//
// 输出：docs/images/*.jpg（JPEG q86，PC 1440x900 / 手机 390x844 @2x）
//
// 说明：
// - 依赖托管工作区的 playwright-core + 系统 Edge（channel: 'msedge'），无需下载 Chromium
// - 角色分配：未登录=首页/登录页；counselor01=学工与生活服务；student004=教务（选课/成绩）
// - 数据驾驶舱需 admin/leader 权限：口令取自环境变量 `E2E_ADMIN_PWD`，
//   未设置时自动回落到项目根 `.env`（该文件已 gitignore，口令不落仓库）；
//   两者都没有则**跳过**该图并保留已有文件，避免用过期截图覆盖
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core');

/** 从项目根 .env 兜底加载（已存在的 process.env 优先；.env 不入库，口令不落仓库） */
function loadDotEnv() {
  try {
    const file = path.resolve(import.meta.dirname, '..', '.env');
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // 无 .env 时静默忽略
  }
}
loadDotEnv();

const BASE = process.env.SHOT_BASE || 'https://c.9o.pw';
const OUT = 'docs/images';
const PWD = 'Zhihui@2026';
// SHOT_ONLY=dashboard 时只重截指定图（其余分组整组跳过，省时间）
const ONLY = new Set((process.env.SHOT_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean));
const want = (name) => ONLY.size === 0 || ONLY.has(name);
const needGroup = (...names) => names.some(want);
fs.mkdirSync(OUT, { recursive: true });

const PC = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const done = [];
const failed = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function shot(page, name) {
  if (!want(name)) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
  const kb = Math.round(fs.statSync(file).size / 1024);
  done.push(`${name} (${kb}KB)`);
  console.log(`  ✓ ${name}.jpg  ${kb}KB`);
}

/** 新建上下文并登录；返回 page */
async function open(viewport, account) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  const page = await ctx.newPage();
  if (account) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await page.getByPlaceholder('用户名').fill(account.username);
    await page.getByPlaceholder('密码').fill(account.password);
    await page.getByRole('button', { name: /登录/ }).click();
    await page.waitForTimeout(3500);
    if (/\/login/.test(page.url())) throw new Error(`登录失败：${account.username}（停留在 ${page.url()}）`);
  }
  return page;
}

/** 访问页面并截图（等待主内容区出现；gate 页无 .shell-main，用 waitShell=false 跳过等待） */
async function visit(page, name, route, wait = 3200, waitShell = true) {
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    if (waitShell) await page.waitForSelector('.shell-main', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(wait);
    await shot(page, name);
  } catch (e) {
    failed.push(`${name}: ${e.message}`);
    console.log(`  ✗ ${name} → ${e.message}`);
  }
}

// ── 1. 未登录：首页 / 登录页 ─────────────────────────────
g1: {
  if (!needGroup('home', 'login', 'mobile-home')) { console.log('[1/4] 跳过（SHOT_ONLY 未命中本组）'); break g1; }
  console.log('[1/4] 未登录页面');
  const page = await open(PC, null);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await shot(page, 'home');
  await visit(page, 'login', '/login', 2500, false);
  await page.close();

  const m = await open(MOBILE, null);
  await m.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(4000);
  await shot(m, 'mobile-home');
  await m.close();
}

// ── 2. 辅导员视角：工作台 + 学工 + 生活服务 ───────────────
g2: {
  if (!needGroup('workbench', 'dorm', 'admin-users', 'approve', 'repair-manage', 'library', 'forum', 'messages', 'mobile-workbench', 'mobile-drawer')) {
    console.log('[2/4] 跳过（SHOT_ONLY 未命中本组）');
    break g2;
  }
  console.log('[2/4] 辅导员视角（counselor01）');
  const page = await open(PC, { username: 'counselor01', password: PWD });
  await visit(page, 'workbench', '/workbench', 3000);
  await visit(page, 'dorm', '/dorm', 3800);
  await visit(page, 'admin-users', '/admin/users', 3400);
  await visit(page, 'approve', '/af/approve', 3400);
  await visit(page, 'repair-manage', '/af/repair-manage', 3400);
  await visit(page, 'library', '/library', 3400);
  await visit(page, 'forum', '/forum', 3400);
  await visit(page, 'messages', '/messages', 3000);
  await page.close();

  const m = await open(MOBILE, { username: 'counselor01', password: PWD });
  await visit(m, 'mobile-workbench', '/workbench', 3000);
  try {
    await m.locator('.shell-burger').click();
    await m.waitForTimeout(900);
    await shot(m, 'mobile-drawer');
  } catch (e) {
    failed.push(`mobile-drawer: ${e.message}`);
  }
  await m.close();
}

// ── 3. 学生视角：教务 ────────────────────────────────────
g3: {
  if (!needGroup('elect', 'scores', 'leave', 'dorm-student')) { console.log('[3/4] 跳过（SHOT_ONLY 未命中本组）'); break g3; }
  console.log('[3/4] 学生视角（student004）');
  const page = await open(PC, { username: 'student004', password: PWD });
  await visit(page, 'elect', '/edu/elect', 3600);
  await visit(page, 'scores', '/edu/scores', 3600);
  await visit(page, 'leave', '/af/leave', 3200);
  await visit(page, 'dorm-student', '/dorm', 3200);
  await page.close();
}

// ── 4. 数据驾驶舱（需 admin/leader 权限）──────────────────
g4: {
  if (!needGroup('dashboard')) { console.log('[4/4] 跳过（SHOT_ONLY 未命中本组）'); break g4; }
  console.log('[4/4] 数据驾驶舱');
  const adminPwd = process.env.E2E_ADMIN_PWD;
  if (!adminPwd) {
    console.log('  ⚠ 环境变量与 .env 均无 E2E_ADMIN_PWD，跳过该图（docs/images 中已有文件保留不动）');
  } else {
    try {
      const page = await open(PC, { username: 'admin', password: adminPwd });
      await visit(page, 'dashboard', '/dashboard', 9000);
      await page.close();
    } catch (e) {
      failed.push(`dashboard: ${e.message}`);
      console.log(`  ✗ dashboard → ${e.message}`);
    }
  }
}

await browser.close();

console.log(`\n完成 ${done.length} 张，失败 ${failed.length} 张`);
if (failed.length) console.log('失败明细：\n  ' + failed.join('\n  '));
process.exit(failed.length ? 1 : 0);
