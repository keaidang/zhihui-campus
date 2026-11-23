// scripts/shots-thesis.mjs — 论文答辩配图（1920x1080，线上真实环境）
//
// 用法：
//   node scripts/shots-thesis.mjs                    # 全部
//   SHOT_ONLY=elect-full,elect-conflict node scripts/shots-thesis.mjs
//
// 输出：docs/thesis-shots/*.png（1920x1080，deviceScaleFactor=1）
// 依赖：托管工作区的 playwright-core + 系统 Edge（channel msedge）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\workspace\\node_modules\\playwright-core');

function loadDotEnv() {
  try {
    const file = path.resolve(import.meta.dirname, '..', '.env');
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* 无 .env 忽略 */
  }
}
loadDotEnv();

const BASE = process.env.SHOT_BASE || 'https://c.9o.pw';
const OUT = path.resolve(import.meta.dirname, '..', 'docs', 'thesis-shots');
const PWD = 'Zhihui@2026';
const ADMIN_PWD = process.env.E2E_ADMIN_PWD || 'admin';

const ONLY = new Set((process.env.SHOT_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean));
const want = (n) => ONLY.size === 0 || ONLY.has(n);
fs.mkdirSync(OUT, { recursive: true });

const VIEW = { width: 1440, height: 810 };
const DPR = 1920 / 1440; // 1.333，输出仍是 1920x1080
const done = [];
const failed = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function shot(page, name, note = '') {
  // ONLY 里写的是语义名（elect-full），文件名带编号（4-4-elect-full），按包含关系匹配
  const hit = ONLY.size === 0 || [...ONLY].some((k) => name.includes(k));
  if (!hit) return null;
  await page.waitForTimeout(300);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: 'png', animations: 'disabled' });
  const kb = Math.round(fs.statSync(file).size / 1024);
  done.push(`${name} (${kb}KB) ${note}`);
  console.log(`  ✓ ${name}.png  ${kb}KB  ${note}`);
  return file;
}

/** 登录并返回 page（WAF 拦截时重试） */
async function open(account, label) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: DPR, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  if (!account) return page;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
      // 偶发返回 WAF 拦截页（没有登录表单），这里等表单出现再填，超时就走重试
      await page.getByPlaceholder('用户名').waitFor({ state: 'visible', timeout: 12000 });
      await page.getByPlaceholder('用户名').fill(account.username);
      await page.getByPlaceholder('密码').fill(account.password);
      await page.getByRole('button', { name: /^登录$/ }).click();
      await page.waitForTimeout(3200);
      if (!/\/login/.test(page.url())) {
        console.log(`  · ${label} 登录成功（第 ${attempt} 次）`);
        return page;
      }
      console.log(`  · ${label} 登录失败（第 ${attempt} 次，${page.url()}），等待重试`);
    } catch (e) {
      console.log(`  · ${label} 登录页异常（第 ${attempt} 次）：${e.message.split('\n')[0]}`);
    }
    await page.waitForTimeout(7000);
  }
  throw new Error(`${label} 登录失败（3 次）`);
}

/** 取当前可见的错误/成功提示文本 */
async function readMessage(page) {
  const el = page.locator('.el-message').last();
  await el.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  return (await el.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

/** 在表格里按文本找到行并点其中的按钮 */
async function clickRowButton(page, rowText, btnText) {
  const row = page.locator('.el-table__row', { hasText: rowText }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const btn = row.getByRole('button', { name: btnText }).first();
  await btn.click();
  return row;
}

try {
  // ── 图 4-4 / 4-5：学生选课（满员 + 冲突）──────────────────────
  if (want('elect-full') || want('elect-conflict')) {
    console.log('[1/5] 学生 student004 · 选课页');
    const page = await open({ username: 'student004', password: PWD }, 'student004');
    await page.goto(`${BASE}/edu/elect`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.el-table__row', { timeout: 20000 });
    await page.waitForTimeout(1200);

    if (want('elect-full')) {
      // 满员：数据结构与算法 周四 5-6 节 91/91
      const rows = page.locator('.el-table__row', { hasText: '数据结构与算法' });
      const n = await rows.count();
      let target = null;
      for (let i = 0; i < n; i += 1) {
        const t = await rows.nth(i).innerText();
        if (t.includes('周四') && t.includes('5-6')) {
          target = rows.nth(i);
          break;
        }
      }
      if (!target) throw new Error('未找到「数据结构与算法 周四 5-6 节」的行');
      await target.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await target.getByRole('button', { name: '选课' }).click();
      const msg = await readMessage(page);
      console.log(`    满员提示：${msg}`);
      await shot(page, '4-4-elect-full', msg.slice(0, 40));
      await page.waitForTimeout(3600); // 等提示消失，避免影响下一张
    }

    if (want('elect-conflict')) {
      const row = page.locator('.el-table__row', { hasText: '计算机网络' }).first();
      await row.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await row.getByRole('button', { name: '选课' }).click();
      const msg = await readMessage(page);
      console.log(`    冲突提示：${msg}`);
      await shot(page, '4-5-elect-conflict', msg.slice(0, 40));
    }
    await page.context().close();
  }

  // ── 图 4-7：请假审批时间线 ──────────────────────────────
  if (want('leave-timeline')) {
    console.log('[2/5] 领导 leader01 · 审批页');
    const page = await open({ username: 'leader01', password: PWD }, 'leader01');
    await page.goto(`${BASE}/af/approve`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.el-table__row', { timeout: 20000 });
    await page.waitForTimeout(1500);

    const row = page.locator('.el-table__row', { hasText: '林小雨' }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await row.getByRole('button', { name: '通过' }).first().click();

    // 等弹窗与时间线渲染
    await page.waitForSelector('.flow-tl', { timeout: 15000 });
    await page.waitForTimeout(900);
    const nodes = await page.locator('.flow-item').count();
    const tx = await page.locator('.flow-tl').innerText();
    console.log(`    时间线节点数：${nodes}`);
    console.log(`    ${tx.replace(/\n/g, ' | ').slice(0, 160)}`);
    // 只截弹窗区域（含标题与时间线），1920 宽下弹窗偏小，放大到 900px 再截更清晰
    // 弹窗宽度已在前端定为 860px（el-dialog 的 width 属性由 Vue 控制，脚本改 style 会被覆盖）
    await page.waitForTimeout(400);
    await shot(page, '4-7-leave-timeline', `${nodes} 节点`);
    await page.keyboard.press('Escape');
    await page.context().close();
  }

  // ── 图 4-8：报修工单详情 ────────────────────────────────
  if (want('repair-detail')) {
    console.log('[3/5] 管理员 admin · 报修管理');
    const page = await open({ username: 'admin', password: ADMIN_PWD }, 'admin');
    await page.goto(`${BASE}/af/repair-manage`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.el-table__row', { timeout: 20000 });
    await page.waitForTimeout(1500);

    // 默认筛选是「待受理」，2030001 是「无法处理」—— 必须先切筛选，否则列表里根本没有这条
    await page.locator('.el-radio-button', { hasText: '无法处理' }).first().click();
    await page.waitForTimeout(1800);
    console.log(`    无法处理工单数：${await page.locator('.el-table__row').count()}`);
    const target = page.locator('.el-table__row', { hasText: '3号宿舍楼' }).first();
    await target.waitFor({ state: 'visible', timeout: 15000 });
    await target.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await target.getByRole('button', { name: '详情' }).first().click();
    await page.waitForSelector('.dt-flow', { timeout: 15000 });
    await page.waitForTimeout(900);
    // 「当前处理说明」六个字在 72px 标签列里会折行，临时把首列加宽（只影响本次截图，不改线上）
    await page.addStyleTag({ content: '.dt-grid{grid-template-columns:96px 1fr !important}.dt-grid span{white-space:nowrap}' });
    const logs = await page.locator('.dt-tl .el-timeline-item').count();
    console.log(`    处理记录：${logs} 条`);
    // 弹窗宽度已在前端定为 880px
    await page.waitForTimeout(400);
    await shot(page, '4-8-repair-detail', `${logs} 条记录`);
    await page.keyboard.press('Escape');
    await page.context().close();
  }

  // ── 图 5-6：AI 写操作二次确认 ────────────────────────────
  if (want('ai-confirm')) {
    console.log('[4/5] 管理员 admin · AI 二次确认');
    const page = await open({ username: 'admin', password: ADMIN_PWD }, 'admin');
    await page.goto(`${BASE}/ai`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // ★ student02 本身已是禁用状态，AI 会回"无需重复操作"（noop），不出确认卡；
    //   要用一个**正常状态**的账号才能触发两阶段确认。
    const input = page.locator('textarea').first();
    await input.click();
    await input.fill('禁用账号 student005 student006 student007');
    await page.waitForTimeout(300);
    // 点发送按钮比 Enter 稳（keydown 绑在 el-input 内部 textarea 上，合成事件未必触发）
    await page.getByRole('button', { name: /发送/ }).click();

    // 等影响清单卡出现（模型解析 + 预览，最长 60s）
    await page.waitForSelector('.ai-op-num', { timeout: 60000 });
    await page.waitForTimeout(1200);
    const card = await page.locator('.ai-op-num').first().innerText();
    console.log(`    影响项：${card}`);
    await shot(page, '5-6-ai-confirm', `影响 ${card} 项`);
    await page.context().close();
  }

  // ── 图 4-10：越权被拦（同账号对照）────────────────────────
  if (want('forbidden')) {
    console.log('[5/5] 越权对照');
    // 左：学生访问管理员页面
    const stu = await open({ username: 'student004', password: PWD }, 'student004');
    await stu.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
    // 提示 4 秒后消失：等页面渲染完就截，别等太久
    await stu.waitForTimeout(1500);
    const stuUrl = stu.url();
    const stuBody = (await stu.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
    console.log(`    学生访问 /admin/users → ${stuUrl}`);
    console.log(`    页面文本：${stuBody.slice(0, 120)}`);
    await shot(stu, '4-10-forbidden-student', '学生视角');
    await stu.context().close();

    // 右：管理员访问同页
    const adm = await open({ username: 'admin', password: ADMIN_PWD }, 'admin');
    await adm.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' });
    await adm.waitForSelector('.el-table__row', { timeout: 20000 }).catch(() => {});
    await adm.waitForTimeout(2000);
    console.log(`    管理员访问 /admin/users → 行数 ${await adm.locator('.el-table__row').count()}`);
    await shot(adm, '4-10-forbidden-admin', '管理员视角');
    await adm.context().close();
  }
} catch (e) {
  failed.push(e.message);
  console.error(`✗ ${e.message}`);
} finally {
  await browser.close();
}

console.log('\n===== 结果 =====');
console.log(`成功 ${done.length} 张：`);
for (const d of done) console.log('  ·', d);
if (failed.length) {
  console.log(`失败 ${failed.length} 项：`);
  for (const f of failed) console.log('  ✗', f);
}
console.log('输出目录：', OUT);
process.exit(failed.length ? 1 : 0);
