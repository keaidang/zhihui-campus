// node-functions/lib/ai-eval.js — AI 效果评估引擎
//
// 定位（依据系里方案 §四（二）「可量化」要求）：
//   把"AI 到底准不准"变成**可重复跑出的数字**，而不是一句主观评价。
//   指标：各场景的**准确率**、平均耗时；审核场景另给**误报率**（负例被误判的比例）。
//
// 三条设计原则：
//   1. **只读评测**：只调用各能力的"判定"环节，不写报修工单、不发帖、不发公告。
//      因此可以随时反复运行（答辩现场跑一次也不脏数据）。
//   2. **跑真实链路**：判定函数与线上接口**同一个**（`triageRepair` / `reviewContent` /
//      `pickTemplate` / `buildKnowledgeContext`），不复制逻辑。否则量的是"另一套实现"。
//   3. **成本透明**：qa 场景是纯本地检索（**零 token**），另外三个场景每次调用模型。
//      因此 limit 可调，答辩演示可以用小样本先跑。
//
// ⚠ 与线上一致的口径：上游聚合网关在密集请求下会抖（失败率可达 30~50%）。评估遇到
//   抖动时把该条记为**失败**并在 detail 里写明原因，**不做重试**——重试会把"网关不稳"
//   这件事从指标里抹掉，反而失真。
import { query } from './db.js';
import { getBool } from './ai-config.js';
import { aiConfigured } from './ai.js';
import { buildKnowledgeContext } from './ai-kb.js';
import { triageRepair } from './ai-triage.js';
import { reviewContent } from './ai-review.js';
import { pickTemplate } from './ai-insight.js';
import { HttpError } from './guard.js';

/**
 * 评估场景目录
 * @property {string|null} need 运行前必须开启的 sys_config 键（null = 不需要开关）
 * @property {boolean} costTokens 是否消耗模型额度
 */
export const SCENES = [
  {
    key: 'qa',
    label: '知识问答（检索层）',
    desc: '判定"该被召回的知识条目有没有被召回"，不评判译文措辞',
    need: null,
    costTokens: false,
  },
  {
    key: 'triage',
    label: '报修智能分诊',
    desc: '判定责任部门是否与人工标注一致（部门是分诊的核心价值）',
    need: 'ai.triage.enabled',
    costTokens: true,
  },
  {
    key: 'review',
    label: '论坛内容审核',
    desc: '判定 verdict 是否与人工标注一致；用例含正常内容，可算误报率',
    need: 'ai.forum_review.enabled',
    costTokens: true,
  },
  {
    key: 'insight',
    label: '信息问数',
    desc: '判定"一句问法 → 模板 key"是否选对',
    need: 'ai.insight.enabled',
    costTokens: true,
  },
];

export const sceneMeta = (key) => SCENES.find((s) => s.key === key) || null;

// ============================================================
// 判定函数（纯函数，可单测）
// 期望值格式见 scripts/seed-ai-eval.mjs 顶部注释
// ============================================================

/**
 * qa：召回的条目里，有任一标题包含期望关键词即算命中
 *
 * ★ expect 支持用 `|` 写**多个候选关键词**（任一命中即算对）。
 *   为什么需要：知识条目的标题会随内容迭代调整（"失物招领"曾被写成
 *   "丢了东西/捡到东西怎么办？"）。若期望值只能写死一个词，改一次标题就会
 *   把评估判成失败 —— 那是**标注在骗人**，不是系统退步。
 *   2026-10-09 首轮评估就是这么暴露出来的：11/12，唯一一条"失败"其实是
 *   系统召回正确、而我的期望值写窄了。
 */
export function judgeQa(expect, sources = []) {
  const kws = String(expect || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!kws.length) return { ok: false, actual: '（用例未标注期望值）' };
  const hit = (sources || []).find((s) => kws.some((kw) => String(s?.title || '').includes(kw)));
  if (hit) return { ok: true, actual: hit.title, hitTitle: hit.title };
  const got = (sources || []).map((s) => s?.title).filter(Boolean).slice(0, 3);
  // 未命中时把"实际召回了什么"记下来：既便于排查，也说明这条不是无理由判错
  return { ok: false, actual: got.length ? `未召回，实际召回：${got.join(' / ')}` : '未召回任何条目' };
}

/** triage：**部门完全匹配**算通过；紧急度单独记录（它有主观性，不作通过标准） */
export function judgeTriage(expect, t) {
  const [wantDept, wantUrgency] = String(expect || '').split('|');
  if (!t || !t.dept) return { ok: false, actual: '未返回分诊结果（能力未开启或调用失败）' };
  // ★★ 降级样本必须单独记为 skipped，不能算"通过"也不能算"错"（2026-10-10 体检发现）：
  //   降级对象是 `{dept:'其他', urgency:'normal', degraded:true}`，
  //   原实现只看 dept，于是**期望部门恰为「其他」的用例在超时时会假通过** ——
  //   而本项目上游抖动率可达 30~50%，评估指标会被网关抖动污染，
  //   而"可量化、可复现"正是这个模块存在的全部意义。
  if (t.degraded) {
    return { ok: false, skipped: true, actual: '（AI 降级未判定，不计入指标）', degraded: true };
  }
  const actual = `${t.dept}|${t.urgency}`;
  return {
    ok: t.dept === wantDept,
    actual,
    deptOk: t.dept === wantDept,
    urgencyOk: t.urgency === wantUrgency,
    selfService: Boolean(t.selfService),
  };
}

/** review：verdict 完全匹配算通过 */
export function judgeReview(expect, r) {
  if (!r || !r.verdict) return { ok: false, actual: '未返回判定结果（能力未开启或调用失败）' };
  // ★★ 同 judgeTriage：降级（verdict 恒为 suspect）不计入指标。
  //   原实现虽然把 degraded 放进了返回值，但 `ok` 仍按 verdict 比对 ——
  //   期望恰为 suspect 的用例会被"抖动"判成通过，且降级还会被
  //   falsePositiveRate 计成误报、被 violationRecall 计成漏检。
  if (r.degraded) {
    return { ok: false, skipped: true, actual: '（AI 降级未判定，不计入指标）', degraded: true };
  }
  return { ok: r.verdict === String(expect || '').trim(), actual: r.verdict };
}

/** insight：模板 key 完全匹配算通过；返回 null 说明"没识别成问数需求" */
export function judgeInsight(expect, templateKey) {
  const want = String(expect || '').trim();
  const actual = templateKey == null ? '(未识别为问数需求)' : String(templateKey);
  return { ok: actual === want, actual };
}

// ============================================================
// 执行
// ============================================================

/** 逐条跑一个场景 */
async function runOne(actor, scene, c) {
  if (scene === 'qa') {
    const kb = await buildKnowledgeContext(c.input, { inlineMaxChars: 4000, topK: 5, minScore: 3, minRatio: 0.25 });
    return judgeQa(c.expect, kb.sources);
  }
  if (scene === 'triage') {
    const t = await triageRepair({ description: c.input, location: '（评估用例）', category: '' });
    return judgeTriage(c.expect, t);
  }
  if (scene === 'review') {
    const r = await reviewContent({ title: '', content: c.input, boardName: '评估', kind: 'thread' }, { userId: actor.userId });
    return judgeReview(c.expect, r);
  }
  if (scene === 'insight') {
    const p = await pickTemplate(actor, c.input);
    // ★ pickTemplate 的返回语义要分清（2026-10-10 体检）：
    //   · 返回 null          = **上游未响应**（超时/失败）→ 本次无法判定，记 skipped
    //   · 返回对象 template=null = 模型认为"这不是问数需求" → 那是真实判定，正常比对
    //   原实现把两者都压成 `p ? p.template : null`，于是上游抖动被算成"模型判断错"，
    //   准确率被无端拉低，掩盖了真实问题。
    if (!p) return { ok: false, skipped: true, actual: '（上游未响应，本次不计入）' };
    return judgeInsight(c.expect, p.template);
  }
  throw new HttpError(49401, `未知的评估场景：${scene}`);
}

/**
 * 跑一个场景并落库
 * @param {{userId:number, roles:string[]}} actor
 * @param {string} scene qa / triage / review / insight
 * @param {{limit?:number, operatorId?:number}} [opts]
 * @returns {Promise<object>} { scene, label, total, passed, failed, accuracy, avgMs, detail[], disabled? }
 */
export async function runScene(actor, scene, { limit = 0, operatorId = 0 } = {}) {
  const meta = sceneMeta(scene);
  if (!meta) throw new HttpError(49401, `未知的评估场景：${scene}`);

  // 开关未开时**不抛错**，而是如实返回 disabled —— 批量评估时不该因为一个场景没开就中断
  if (meta.need && !(await getBool(meta.need, false))) {
    return { scene, label: meta.label, disabled: `需先在【功能开关】中开启 ${meta.need}`, total: 0, passed: 0, failed: 0, skipped: 0, accuracy: 0, avgMs: 0, detail: [] };
  }
  if (!aiConfigured()) {
    return { scene, label: meta.label, disabled: 'AI 未配置密钥', total: 0, passed: 0, failed: 0, skipped: 0, accuracy: 0, avgMs: 0, detail: [] };
  }

  const lim = Math.max(0, Math.min(200, Number(limit) || 0));
  const cases = lim
    ? await query('SELECT id, input, expect, note FROM ai_eval_case WHERE scene = ? AND status = 1 ORDER BY id LIMIT ?', [scene, lim])
    : await query('SELECT id, input, expect, note FROM ai_eval_case WHERE scene = ? AND status = 1 ORDER BY id', [scene]);

  if (!cases.length) {
    return { scene, label: meta.label, total: 0, passed: 0, failed: 0, skipped: 0, accuracy: 0, avgMs: 0, detail: [], empty: '该场景还没有启用中的用例' };
  }

  const detail = [];
  for (const c of cases) {
    const t0 = Date.now();
    let judged;
    try {
      judged = await runOne(actor, scene, c);
    } catch (e) {
      judged = { ok: false, actual: `执行异常：${String(e?.message || e).slice(0, 80)}` };
    }
    detail.push({
      caseId: c.id,
      input: c.input,
      expect: c.expect,
      actual: judged.actual ?? '',
      ok: Boolean(judged.ok),
      // ★ 降级/上游未响应：既不算通过也不算失败，单独统计
      skipped: Boolean(judged.skipped),
      ms: Date.now() - t0,
      note: c.note || '',
      // 分项（triage 的紧急度一致、review 的降级标记）供页面展示，不参与通过判定
      extra: judged.deptOk === undefined && judged.urgencyOk === undefined && judged.degraded === undefined
        ? undefined
        : { deptOk: judged.deptOk, urgencyOk: judged.urgencyOk, degraded: judged.degraded },
    });
  }

  const total = detail.length;
  // ★ 准确率的分母是**有效样本**（总样本 − 降级样本），不是总样本（2026-10-10 体检）。
  //   否则上游抖动会直接压低准确率，让"模型能力"与"网关健康度"混在一起，
  //   指标既不能反映模型好坏，也不能反映服务可用性。
  const skipped = detail.filter((d) => d.skipped).length;
  const effective = total - skipped;
  const passed = detail.filter((d) => d.ok).length;
  const failed = effective - passed;
  const avgMs = total ? Math.round(detail.reduce((s, d) => s + d.ms, 0) / total) : 0;
  const accuracy = effective ? Math.round((passed / effective) * 10000) / 10000 : 0;

  await query(
    `INSERT INTO ai_eval_run (scene, total, passed, failed, skipped, avg_ms, accuracy, detail, operator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [scene, total, passed, failed, skipped, avgMs, accuracy, JSON.stringify(detail), Number(operatorId) || 0],
  );

  return { scene, label: meta.label, total, passed, failed, skipped, effective, accuracy, avgMs, detail };
}

/** 审核场景的误报率：把**正常内容**误判成违规/可疑的比例（越低越好） */
export function falsePositiveRate(detail = []) {
  // ★ 排除降级样本（2026-10-10 体检）：降级时 verdict 恒为 suspect，
  //   会把"上游抖动"算成"把正常内容误判成违规"，误报率被凭空抬高。
  const negatives = detail.filter((d) => String(d.expect).trim() === 'ok' && !d.skipped);
  if (!negatives.length) return null;
  const wrong = negatives.filter((d) => !d.ok).length;
  return { total: negatives.length, wrong, rate: Math.round((wrong / negatives.length) * 10000) / 10000 };
}

/** 审核场景的违规检出率：真正违规的内容被判出 violation 的比例 */
export function violationRecall(detail = []) {
  // ★ 同上：降级样本不计入召回率分母，否则抖动会被算成"漏检违规内容"。
  const positives = detail.filter((d) => String(d.expect).trim() === 'violation' && !d.skipped);
  if (!positives.length) return null;
  const hit = positives.filter((d) => String(d.actual).trim() === 'violation').length;
  return { total: positives.length, hit, rate: Math.round((hit / positives.length) * 10000) / 10000 };
}

/** 用例统计（页面顶部显示"数据集规模"） */
export async function caseStats() {
  const rows = await query('SELECT scene, COUNT(*) AS n FROM ai_eval_case WHERE status = 1 GROUP BY scene');
  const map = {};
  for (const r of rows) map[r.scene] = Number(r.n);
  return { byScene: map, total: Object.values(map).reduce((a, b) => a + b, 0) };
}

/** 各场景最近一次运行结果（页面主视图） */
export async function latestRuns() {
  const scenes = SCENES.map((s) => s.key);
  const out = [];
  for (const s of scenes) {
    const rows = await query(
      'SELECT id, total, passed, failed, skipped, avg_ms, accuracy, detail, created_at FROM ai_eval_run WHERE scene = ? ORDER BY id DESC LIMIT 1',
      [s],
    );
    if (!rows.length) {
      out.push({ scene: s, never: true });
      continue;
    }
    const r = rows[0];
    let detail = [];
    try {
      detail = JSON.parse(r.detail || '[]');
    } catch {
      detail = [];
    }
    out.push({
      scene: s,
      id: r.id,
      total: Number(r.total),
      passed: Number(r.passed),
      failed: Number(r.failed),
      avgMs: Number(r.avg_ms),
      accuracy: Number(r.accuracy),
      createdAt: r.created_at,
      detail,
      falsePositive: s === 'review' ? falsePositiveRate(detail) : null,
      violationRecall: s === 'review' ? violationRecall(detail) : null,
    });
  }
  return out;
}
