// tests/unit/code-label.spec.js —— 内部代号中文化的「防漂移」测试
//
// ★ 这条测试存在的意义（铁律 #56 + #60 的组合）：
//   界面上的中文映射表**一定会腐化** —— 以后有人新增一个 `user.freeze` 动作，
//   代码里写得很自然、界面也能跑，只是那一格显示 "user.freeze"，
//   要等到用户截图反馈才发现。所以这里用**扫源码**的方式把映射表钉死：
//   凡是会写进 `sys_op_log.action` 的动作码、凡是会写进 `ai_usage_log.kind` 的用途，
//   都必须在 `src/utils/code-label.js` 里有中文；缺一个就判失败。
//
//   扫描前**必须先剥掉注释** —— 否则文件头里那些举例说明用的 `opLog(…, 'x.y')`
//   会混进集合，让测试变成"必须给注释也配翻译"的噪声（铁律 #60 的同款教训）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  aiKindLabel, opActionLabel, opTargetLabel, opDetailLabel,
  UNKNOWN_ACTION, UNKNOWN_KIND, __maps,
} from '../../src/utils/code-label.js';

const ROOT = process.cwd();

function walkJs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(p, acc);
    else if (entry.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

/** 去掉 // 与 /* *\/ 注释，避免注释里的示例代号污染集合 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 扫出所有会落进 sys_op_log.action 的动作码。
 *
 * 取的是 `opLog(` 的**第 2 个实参**（也就是 action 本身），不是"往后 200 字符里的所有字面量"——
 * 后者会顺带捞进请求体里的 action 值（例如 `if (action === 'import.courses')`），
 * 守卫一旦有噪声就会被当成噪声忽略，那等于没有守卫。
 */
function collectActionCodes() {
  const codes = new Set();
  // 非 opLog() 的三处直写：ai.error / error.500 / error.bodyUnreadable（见 lib/ai.js、lib/http.js）
  for (const literal of ['ai.error', 'error.500', 'error.bodyUnreadable']) codes.add(literal);
  for (const file of walkJs(path.join(ROOT, 'node-functions'))) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (let i = src.indexOf('opLog('); i !== -1; i = src.indexOf('opLog(', i + 1)) {
      const start = i + 'opLog('.length;
      let depth = 0;
      let firstComma = -1;
      let end = src.length;
      for (let k = start; k < src.length; k += 1) {
        const ch = src[k];
        if (ch === '(' || ch === '[' || ch === '{') depth += 1;
        else if (ch === ')' || ch === ']' || ch === '}') {
          if (depth === 0) { end = k; break; }
          depth -= 1;
        } else if (ch === ',' && depth === 0 && firstComma === -1) firstComma = k;
      }
      if (firstComma === -1) continue;
      const arg2 = src.slice(firstComma + 1, end);
      // 兼容 `confirm ? 'a.b' : 'c.d'` 这类三元：两个分支都是合法动作码
      for (const m of arg2.matchAll(/'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g)) codes.add(m[1]);
    }
  }
  return codes;
}

/** 扫出所有会落进 ai_usage_log.kind 的用途码 */
function collectAiKinds() {
  const kinds = new Set(['other']); // logAiUsage 的默认值
  for (const file of walkJs(path.join(ROOT, 'node-functions'))) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (let i = src.indexOf('logAiUsage('); i !== -1; i = src.indexOf('logAiUsage(', i + 1)) {
      for (const m of src.slice(i, i + 260).matchAll(/kind:\s*'([a-z_]+)'/g)) kinds.add(m[1]);
    }
  }
  return kinds;
}

const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s);

describe('内部代号中文化（铁律 #56：只有内部人看得懂的代号不上界面）', () => {
  it('扫源码得到的动作码集合不为空（防扫描器本身失效变成空转通过）', () => {
    const codes = collectActionCodes();
    expect(codes.size).toBeGreaterThan(30);
    expect(codes.has('lib.return')).toBe(true);
    expect(codes.has('ai.review.confirm')).toBe(true);
  });

  it('每个落库的动作码都有中文映射，新增动作漏翻会在这里被拦住', () => {
    const missing = [...collectActionCodes()].filter((c) => !__maps.OP_ACTION_LABEL[c]).sort();
    expect(missing, `未配中文的动作码：${missing.join(' / ')}`).toEqual([]);
  });

  it('每个 AI 调用用途都有中文映射', () => {
    const missing = [...collectAiKinds()].filter((k) => !__maps.AI_KIND_LABEL[k]).sort();
    expect(missing, `未配中文的用途码：${missing.join(' / ')}`).toEqual([]);
  });

  it('映射值本身必须是中文，不能把英文原样抄一遍（抄一遍等于没翻）', () => {
    const bad = [];
    for (const [code, label] of Object.entries(__maps.OP_ACTION_LABEL)) {
      if (!hasChinese(label) || label === code) bad.push(`${code} → ${label}`);
    }
    for (const [code, label] of Object.entries(__maps.AI_KIND_LABEL)) {
      if (!hasChinese(label) || label === code) bad.push(`${code} → ${label}`);
    }
    expect(bad, `以下映射不是中文：${bad.join(' / ')}`).toEqual([]);
  });
});

describe('代号 → 界面文案', () => {
  it('已登记的动作显示中文', () => {
    expect(opActionLabel('user.setStatus')).toBe('启用/禁用账号');
    expect(opActionLabel('lib.return')).toBe('图书归还');
    expect(aiKindLabel('lf_match')).toBe('失物匹配');
  });

  it('未登记的代号显示中文占位，而不是把英文原样抛给用户', () => {
    // 未知代号必须"降级为可读文案"，但原码要由调用方放进 title（见 DashboardView），
    // 这样界面不出现英文，排查线索也不丢。
    expect(opActionLabel('user.freeze')).toBe(UNKNOWN_ACTION);
    expect(UNKNOWN_ACTION).not.toMatch(/[A-Za-z]/);
    expect(aiKindLabel('brandNewKind')).toBe(UNKNOWN_KIND);
    expect(UNKNOWN_KIND).not.toMatch(/[A-Za-z]/);
    expect(opActionLabel(null)).toBe(UNKNOWN_ACTION);
    expect(aiKindLabel(undefined)).toBe(UNKNOWN_KIND);
  });

  it('对象列把 user:123 翻成中文前缀，没有前缀形态的原样返回（不硬套）', () => {
    expect(opTargetLabel('user:10144481')).toBe('账号 10144481');
    expect(opTargetLabel('leave:2090325')).toBe('请假单 2090325');
    expect(opTargetLabel('1586356753@qq.com')).toBe('1586356753@qq.com');
    expect(opTargetLabel('')).toBe('');
  });

  it('明细列只替换能确定含义的英文记号，其余原样保留（不猜、不丢信息）', () => {
    expect(opDetailLabel('via:ai 0')).toBe('来源：AI 操作 0');
    expect(opDetailLabel('handledBy=ai')).toBe('处理人：AI');
    expect(opDetailLabel('student004')).toBe('student004');
    expect(opDetailLabel('')).toBe('');
  });
});
