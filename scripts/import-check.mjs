// scripts/import-check.mjs — 部署前自检：把所有 Node Functions / Edge Functions 模块 import 一遍
//
// 为什么需要它（2026-10-09 踩实）：
//   线上 P8 推送后，`/api/ai/*` 迟迟不生效、一直回落到 SPA —— **没有任何报错可见**。
//   根因是一个 `import { clientIp } from '../../lib/guard.js'`（该导出其实在 lib/http.js）。
//   这类"导入不存在的导出"会让 EdgeOne 构建失败，而 EdgeOne Pages **只在构建日志里提示**，
//   从外部看就是"部署没生效"，极易误判为"平台慢"或"代码逻辑错"。
//   本地跑这个脚本 1 秒就能定位。
//
// 用法：`npm run check:import`（已并入 npm run check）
// 退出码：0 = 全部可加载；1 = 有模块加载失败（**不要推送**）
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out; // 目录不存在（例如 CI 上没有 edge-functions）直接跳过
  }
  for (const name of names) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const targets = [path.join(root, 'node-functions'), path.join(root, 'edge-functions')].flatMap(walk);
let bad = 0;
for (const f of targets) {
  try {
    await import(pathToFileURL(f).href);
  } catch (e) {
    bad += 1;
    console.log(`❌ ${path.relative(root, f)}`);
    console.log(`   ${e?.message}`);
  }
}

console.log(`模块加载自检：共 ${targets.length} 个，失败 ${bad} 个`);
if (bad) console.log('⚠ 有模块无法加载 → 推送后 EdgeOne 构建会失败，线上表现为"部署不生效"。先修再推。');
process.exit(bad ? 1 : 0);
