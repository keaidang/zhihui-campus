// node-functions/lib/ai-intent.js —— 确定性意图识别与槽位抽取（**不依赖模型**）
//
// ── 它解决什么问题 ────────────────────────────────────────────────────
// 在此之前，一句话能不能变成动作**完全押在模型抽参上**：
//   · 模型偶尔输出 `query_leaves` 而不是 `approve_leaves` → 用户说"批一下"却看到一张表；
//   · 模型把「方欣雪的请假」整段塞进 keyword → SQL `LIKE '%方欣雪的请假%'` 必然落空 → "找不到"；
//   · 模型把姓名塞进 usernames（而请假动作只认 keyword）→ 同样落空；
//   · 措辞稍变（"把假批了""给过了吧"）就抽不出任何参数 → 反问一轮，体验断掉。
//
// ── 设计原则 ──────────────────────────────────────────────────────────
// 1. **纯函数、零依赖、零 IO**：本文件不查库、不调模型，只做文本 → 结构化意图/槽位。
//    因此可以穷举式单测，且不影响任何现有链路。
// 2. **只做"候选"，不做"决定"**：抽出来的姓名/单号/账号一律当**候选**，
//    最终是否命中由服务端 SQL 精确判定（见 `ai-actions.js` 的目标解析）。
//    所以这里宁可多抽几个，也不会因为抽错而操作到别人。
// 3. **模型优先、规则兜底/纠偏**：模型给出的 action 与参数仍然优先；
//    只有当模型"没抽出来"或"明显抽反了"时，才由本文件补位（见 `api/ai/action.js`）。
// 4. **不新增权限面**：本文件不知道 actor 是谁，也不知道数据范围 ——
//    越权判定始终在 `lib/guard.js` / `lib/services/*` 那一层。

/** 强动词：几乎只可能表示某个动作（权重 2） */
const STRONG = {
  approve_leaves: ['批准', '通过', '同意', '准假', '批了', '批一下', '批吧', '给批', '审过', '放行', '批下来'],
  reject_leaves: ['驳回', '不批', '不同意', '拒绝', '打回', '拒批', '不给批'],
  disable_users: ['禁用', '停用', '封禁', '封掉', '锁定', '冻结', '拉黑', '停掉'],
  enable_users: ['启用', '解封', '解锁', '恢复使用', '恢复'],
  publish_notice: ['发布', '公布', '推送', '发个', '发条', '起草'],
  revoke_notice: ['撤回', '撤销', '下架', '删掉', '删除', '取消发布'],
  pin_notice: ['置顶', '顶置', '取消置顶', '取消顶置'],
  confirm_violation: ['确认违规', '判定违规', '处置违规', '确认下架'],
  query_leaves: ['查询', '查看', '查一下', '查下', '列出', '看看', '看一下', '显示', '统计', '汇总', '有多少', '多少个', '几条'],
  query_users: ['查询', '查看', '查一下', '查下', '列出', '看看', '看一下', '显示', '统计', '有多少', '多少个'],
  query_notices: ['查询', '查看', '查一下', '查下', '列出', '看看', '看一下', '显示'],
  query_review_queue: ['查询', '查看', '查一下', '列出', '看看', '显示'],
  reset_user_password: ['重置密码', '重置登录密码', '重置账号密码', '密码重置', '恢复默认密码', '改密码', '重置为默认密码', '重置', '重设'],
};

/** 反例词：出现这些词说明**不是**该动作（防止"重置邮箱密码"被当成重置登录密码） */
const EXCLUDE = {
  reset_user_password: ['邮箱', 'mail'],
};

/** 必须带宾语才算数的动作（否则"重置一下筛选条件"会被当成重置密码） */
const REQUIRE_OBJ = {
  reset_user_password: true,
};

/** 弱动词：只在有明确宾语时才算数（权重 1）——「审批」本身既可能是查询也可能是批准 */
const WEAK = {
  approve_leaves: ['审批', '过了', '过吧'],
  reject_leaves: ['拒'],
  disable_users: ['关掉', '停'],
};

/** 领域宾语，权重 1；同时也是"资格门槛"的一部分 */
const OBJECTS = {
  leave: ['请假', '假条', '假单', '休假', '病假', '事假', '销假', '假'],
  users: ['账号', '帐号', '账户', '用户', '教师', '老师', '学生', '辅导员', '管理员'],
  notice: ['公告', '通知', '通告'],
  review: ['违规', '待复核', '复核', '审核记录', '审核'],
  pwd: ['密码', '口令'],
};

/** 动作 → 允许的宾语域（不在域内的宾语不算分） */
const ACTION_OBJECTS = {
  approve_leaves: ['leave'],
  reject_leaves: ['leave'],
  query_leaves: ['leave'],
  disable_users: ['users'],
  enable_users: ['users'],
  query_users: ['users'],
  publish_notice: ['notice'],
  revoke_notice: ['notice'],
  pin_notice: ['notice'],
  query_notices: ['notice'],
  confirm_violation: ['review'],
  query_review_queue: ['review'],
  reset_user_password: ['users', 'pwd'],
};

/** 噪声词：抽姓名时先剔除（按长度降序剔除，避免「的请假」被拆成两半） */
const NAME_NOISE = [
  '帮我', '帮忙', '麻烦', '请你', '请', '给我', '把', '给', '对', '让',
  '这条', '那条', '这个', '那个', '这些', '那些', '这张', '那张', '这一条', '那一条',
  '所有', '全部', '一律', '统统', '待审批', '审批中', '未审批', '已批准', '已驳回', '已销假',
  '请假单', '请假条', '请假', '假条', '假单', '销假', '病假', '事假', '休假', '假',
  '审批', '批准', '通过', '同意', '驳回', '拒绝', '不批', '批了', '批一下', '批',
  '禁用', '停用', '启用', '解封', '封禁', '锁定', '冻结', '恢复',
  '账号', '帐号', '账户', '用户', '老师', '教师', '同学', '学生', '辅导员', '管理员', '工号', '学号',
  '公告', '通知', '通告', '发布', '撤回', '撤销', '下架', '删除', '删掉', '置顶', '打回', '过了', '过吧',
  '记录', '单子', '单据', '申请', '情况', '列表', '信息', '数据', '一下', '的', '了', '吧', '吗', '呢', '啊',
  '密码', '登录密码', '账号密码', '默认密码', '口令', '重置', '重设', '改密', '改',
  '今天', '昨天', '明天', '本周', '这周', '上周', '最近', '刚才', '上面', '下面',
];

/** 候选姓名最长 4 个汉字（库里的 real_name 是 2~4 字），超过就取尾段 */
const NAME_MIN = 2;
const NAME_MAX = 4;

/** 命中计分：强动词 2 分、弱动词 1 分、宾语 1 分 */
function hitWords(words, text) {
  // ★ 先按长度降序，再剔除"已被更长命中词包含"的短词：
  //   否则「审批」会同时命中 approve 的「审批」和「批」，白送一分，
  //   导致「看看待审批的请假」被判成"批准"（2026-10-20 实测踩到）。
  const matched = words.filter((w) => text.includes(w)).sort((a, b) => b.length - a.length);
  const kept = [];
  for (const w of matched) if (!kept.some((k) => k.includes(w))) kept.push(w);
  return kept;
}

function scoreAction(action, text) {
  const strongAll = STRONG[action] || [];
  const weakAll = WEAK[action] || [];
  const allHits = hitWords([...strongAll, ...weakAll], text);
  const strong = allHits.filter((w) => strongAll.includes(w));
  const weak = allHits.filter((w) => weakAll.includes(w));
  const objs = hitWords((ACTION_OBJECTS[action] || []).flatMap((domain) => OBJECTS[domain] || []), text);
  return { strong, weak, objs, verbs: strong.length * 2 + weak.length, score: strong.length * 2 + weak.length + (objs.length ? 1 : 0) };
}

/** 领域词（动词 + 宾语）：姓名候选里若还含着它们，说明是"句子碎片"而不是人名 */
const DOMAIN_WORDS = [...new Set([...Object.values(STRONG).flat(), ...Object.values(WEAK).flat(), ...Object.values(OBJECTS).flat()])].sort(
  (a, b) => b.length - a.length,
);

/** 从候选里剔掉领域词，剩下的才是"像人名"的部分（如「看待复核」→「看待」） */
function stripDomainWords(s) {
  let v = String(s || '');
  for (const w of DOMAIN_WORDS) v = v.split(w).join('');
  return v.trim();
}

/**
 * 从一句话里抽「姓名候选」。
 *
 * 做法：去掉 ASCII/标点 → 得到中文片段 → 逐段剔除噪声词 → 剩下的 2~4 字片段即候选；
 * 超过 4 字的片段取**尾段**（中文里姓名通常紧跟在动词后面，如「通过方欣雪的请假」）。
 *
 * ★ 只是候选：命中与否由 SQL `LIKE` 判定，所以多抽几个不会误伤数据。
 * @param {string} text
 * @returns {string[]}
 */
export function extractNames(text) {
  const t = String(text || '');
  const segs = t
    .replace(/[A-Za-z0-9_#./:\\@%+\-*]+/g, ' ')
    .split(/[^\u4e00-\u9fa5]+/)
    .filter(Boolean);

  const noise = [...new Set(NAME_NOISE)].sort((a, b) => b.length - a.length);
  const out = [];

  for (const seg of segs) {
    let s = seg;
    for (const w of noise) s = s.split(w).join(' ');
    for (const part of s.split(/\s+/).filter(Boolean)) {
      const raw = part.length <= NAME_MAX ? [part] : [part.slice(-NAME_MAX), part.slice(-3)];
      for (const cand of raw) {
        const clean = stripDomainWords(cand);
        if (clean.length >= NAME_MIN && clean.length <= NAME_MAX) out.push(clean);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * 识别一句话对应的动作。
 *
 * 采用**打分 + 资格门槛**，而不是"命中第一个关键词就返回"：
 *   · 资格：要么有宾语（请假/账号/公告…），要么有两个强动词，要么句子里带了明确目标（姓名/账号/单号）；
 *   · 并列最高分时返回 null（交给模型），避免"撤销公告"被猜成"撤销审批"这类误判。
 *
 * @param {string} text
 * @returns {{action:string, score:number, strong:string[], weak:string[], objects:string[], reason:string}|null}
 */
export function classifyIntent(text) {
  const t = String(text || '');
  if (!t.trim()) return null;

  const targets = extractTargets(t);
  const hasTarget = (targets.names?.length || 0) + (targets.usernames?.length || 0) + (targets.leaveIds?.length || 0) > 0;

  let best = null;
  let tie = false;
  for (const action of Object.keys(ACTION_OBJECTS)) {
    // 反例词：命中即整条规则作废（如"重置**邮箱**密码"不是重置登录密码）
    if ((EXCLUDE[action] || []).some((w) => t.includes(w))) continue;
    const s = scoreAction(action, t);
    if (!s.score) continue;
    // ★ 资格门槛：**必须有一个动词**，并且满足其一（有宾语 / 有明确目标 / 两个强动词）。
    //   只靠宾语（如「请假流程是什么」）一律不算操作意图 —— 那种句子交给模型回答。
    const qualified = s.verbs > 0 && (s.objs.length > 0 || hasTarget || s.strong.length >= 2);
    if (REQUIRE_OBJ[action] && !s.objs.length) continue;
    if (!qualified) continue;
    if (!best || s.score > best.score) {
      best = { action, ...s, reason: `strong=${s.strong.join('/') || '-'} weak=${s.weak.join('/') || '-'} obj=${s.objs.join('/') || '-'}` };
      tie = false;
    } else if (s.score === best.score && s.action !== best.action) {
      tie = true;
    }
  }
  if (!best || tie) return null;
  return best;
}


/**
 * 抽取槽位（与动作无关，一次性把能确定的都抽出来，再按动作取用）。
 *
 * 说明：这里抽的**全部是候选**，且都是"用户明确说出来的"信息，不做任何脑补。
 * @param {string} text
 * @returns {{leaveIds?:number[], usernames?:string[], names?:string[], status?:string, all?:boolean, opinion?:string, title?:string, content?:string, countOnly?:string}}
 */
export function extractTargets(text) {
  const t = String(text || '');
  const out = {};

  // ---- 单号：带标签的允许 2 位以上；裸数字要求 4 位以上（避免把"7 天""30 条"当单号）----
  const ids = new Set();
  for (const m of t.matchAll(/(?:单号|编号|序号|#|No\.?)\s*[:：]?\s*(\d{2,})/gi)) ids.add(Number(m[1]));
  for (const m of t.matchAll(/(?<!\d)(\d{4,})(?!\d)/g)) ids.add(Number(m[1]));
  out.leaveIds = [...ids].filter((n) => Number.isFinite(n) && n > 0).slice(0, 20);
  if (!out.leaveIds.length) delete out.leaveIds;

  // ---- 账号：ASCII 且含数字（student01/teacher01），或恰为 admin ----
  const users = new Set();
  for (const m of t.matchAll(/[A-Za-z][A-Za-z0-9_]{2,31}/g)) {
    const w = m[0];
    if (/\d/.test(w) || w.toLowerCase() === 'admin') users.add(w);
  }
  out.usernames = [...users].slice(0, 10);
  if (!out.usernames.length) delete out.usernames;

  // ---- 公告 / 审核记录编号（这两类 id 可能只有 1~3 位，不能套用"4 位以上"的规则）----
  const nid = t.match(/(?:公告|通知|通告)\s*(?:编号|id|#|No\.?)?\s*[:：]?\s*(\d{1,9})/i);
  if (nid) out.noticeId = Number(nid[1]);
  const rid = t.match(/(?:违规记录|审核记录|复核记录|记录)\s*(?:编号|id|#)?\s*[:：]?\s*(\d{1,9})/i);
  if (rid) out.reviewId = Number(rid[1]);

  // ---- 姓名候选 ----
  out.names = extractNames(t);
  if (!out.names.length) delete out.names;

  // ---- 请假状态 ----
  if (/待审批|审批中|未审批|还没批|没批/.test(t)) out.status = '1';
  else if (/已批准|已通过|批过的/.test(t)) out.status = '2';
  else if (/已驳回|被驳回|驳回过/.test(t)) out.status = '3';
  else if (/已销假|销过假/.test(t)) out.status = '4';

  // ---- 账号状态（"有多少个**禁用**的账号"必须只数禁用的，不能给全校总数）----
  if (/禁用|封禁|停用|锁定|冻结|拉黑|被禁/.test(t)) out.accountStatus = '0';
  else if (/已启用|启用中|正常状态/.test(t)) out.accountStatus = '1';

  // ---- 批量意图（刻意不含「都」——「他的假都批了」不是"批所有"）----
  if (/全部|所有|一律|统统|挨个|逐个/.test(t)) out.all = true;

  // ---- 只要个数 ----
  if (/多少|几个|总数|数量|人数|共几/.test(t)) out.countOnly = '1';

  // ---- 审批意见 / 理由 ----
  const op = t.match(/(?:理由|原因|意见)\s*[:：是为]?\s*([^，。;；\n]{1,50})/);
  if (op) out.opinion = op[1].trim();

  // ---- 公告标题 / 正文（"标题：xxx 内容：yyy"）----
  // ★ 标题用**非贪婪**并停在「正文/内容」之前，否则会把整段正文也吞进标题。
  const ti = t.match(/(?:标题|题目)\s*[:：]\s*([^\n，。;；]{1,60}?)(?:\s*(?:正文|内容)\s*[:：]|$)/);
  if (ti) out.title = ti[1].trim();
  const co = t.match(/(?:正文|内容)\s*[:：]\s*([\s\S]{1,500})/);
  if (co) out.content = co[1].trim();

  return out;
}

/**
 * 合并参数：**模型优先，规则补空**；数组类（单号/账号/姓名）取并集。
 *
 * ★ 并集而不是覆盖：模型抽到一个姓名、规则抽到另一个（例如"方欣雪和唐晨凡"），
 *   只保留一方就会漏掉一半目标。候选再多也不会越权 —— 最终仍由 SQL + scope 决定命中。
 */
export function mergeParams(modelParams = {}, ruleSlots = {}) {
  const out = { ...(modelParams && typeof modelParams === 'object' ? modelParams : {}) };
  for (const [k, v] of Object.entries(ruleSlots || {})) {
    if (k === 'leaveIds' || k === 'usernames' || k === 'names') {
      const a = Array.isArray(out[k]) ? out[k] : out[k] ? [out[k]] : [];
      const b = Array.isArray(v) ? v : v ? [v] : [];
      const merged = [...new Set([...a, ...b])];
      if (merged.length) out[k] = merged;
      continue;
    }
    const empty = out[k] === undefined || out[k] === null || out[k] === '' || (Array.isArray(out[k]) && out[k].length === 0);
    if (empty) out[k] = v;
  }
  return out;
}

/** 模型是否真的抽到了可用参数（用于判断"要不要让规则纠偏"） */
export function hasUsableParams(params = {}) {
  return Object.values(params || {}).some((v) => {
    if (v === undefined || v === null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  });
}

/**
 * 按动作挑出**有意义的**槽位。
 *
 * ★ 必须过滤（2026-10-20）：`extractTargets` 是"一次性全抽"，里面混着与人名无关的候选
 *   （例如「发布公告：周末停电通知」会抽出"周末电"）。若原样塞给请假解析，
 *   就会拿"周末电"去 `LIKE` 查请假单 —— 多一次无用查询，还可能给出误导性提示。
 *
 * @param {object} slots extractTargets 的结果
 * @param {string} action 动作 key
 */
export function slotsForAction(slots = {}, action = '') {
  const pick = (...keys) => {
    const o = {};
    for (const k of keys) if (slots[k] !== undefined) o[k] = slots[k];
    return o;
  };
  switch (action) {
    case 'approve_leaves':
    case 'reject_leaves':
      // usernames 也一并带上：模型经常把学生姓名塞进 usernames（请假动作只认 keyword）
      return pick('leaveIds', 'names', 'usernames', 'status', 'all', 'opinion');
    case 'query_leaves':
      return pick('names', 'usernames', 'status');
    case 'disable_users':
    case 'enable_users':
      return pick('usernames', 'names', 'all');
    case 'reset_user_password':
      return pick('usernames', 'names', 'all');
    case 'query_users': {
      // 账号状态（禁用/正常）要带上，否则「有多少个禁用的账号」会返回全校总数
      const o = pick('usernames', 'names', 'all', 'countOnly');
      if (slots.accountStatus) o.status = slots.accountStatus;
      return o;
    }
    case 'publish_notice':
      return pick('title', 'content');
    case 'revoke_notice':
    case 'pin_notice':
      return pick('noticeId');
    case 'confirm_violation':
      return pick('reviewId');
    default:
      return {};
  }
}

