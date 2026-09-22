// scripts/check-readme.mjs — README 完整性自检（图片与文档链接是否都存在）
// 用法：node scripts/check-readme.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const md = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

let bad = 0;

// 1) 图片引用（markdown 与 HTML img 两种写法）
const imgs = new Set();
for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) imgs.add(m[1]);
for (const m of md.matchAll(/<img[^>]+src="([^"]+)"/g)) imgs.add(m[1]);
console.log(`\n=== 图片引用（${imgs.size} 处）===`);
for (const src of [...imgs].sort()) {
  const ok = fs.existsSync(path.join(root, src));
  if (!ok) bad++;
  console.log(`  ${ok ? '✅' : '❌'} ${src}`);
}

// 2) 站内文档链接（忽略外链与锚点）
const links = new Set();
for (const m of md.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  const t = m[1];
  if (/^https?:/.test(t) || t.startsWith('#')) continue;
  links.add(t.split('#')[0]);
}
console.log(`\n=== 站内链接（${links.size} 处）===`);
for (const t of [...links].sort()) {
  const ok = fs.existsSync(path.join(root, t));
  if (!ok) bad++;
  console.log(`  ${ok ? '✅' : '❌'} ${t}`);
}

// 3) 过时内容检查（用完整路径片段匹配，避免 node-functions/ 之类子串误报）
console.log('\n=== 过时内容检查 ===');
const stale = ['miniprogram/', 'web-admin/', '├── functions/', '├── seed/', 'uni-app 小程序端'];
for (const s of stale) {
  const hit = md.includes(s);
  if (hit) bad++;
  console.log(`  ${hit ? '❌ 仍含过时表述' : '✅ 未出现'}  ${s}`);
}

// 4) 图片体积
console.log('\n=== 图片总体积 ===');
const dir = path.join(root, 'docs/images');
let total = 0;
for (const f of fs.readdirSync(dir)) total += fs.statSync(path.join(dir, f)).size;
console.log(`  ${fs.readdirSync(dir).length} 个文件，共 ${(total / 1024 / 1024).toFixed(2)} MB`);

console.log(`\n${bad === 0 ? '✅ README 自检全部通过' : `❌ 存在 ${bad} 处问题`}`);
process.exit(bad ? 1 : 0);
