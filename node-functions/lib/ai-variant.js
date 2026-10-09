// node-functions/lib/ai-variant.js — AI 能力分级（累加式）与能力目录
//
// 设计依据 docs/AI-FEATURES.md §1.4：
//   标准版（全员）→ 审批版（counselor 累加 C4）→ 校领导版（leader 累加 C6 只读）
//   → 管理员版（admin 累加 C5 写操作 + 管理控制台）
// 「累加」的实现方式：每个能力只声明**自己需要哪些角色**，不做减法；
// 判定一律用 `roles.includes()` 校验，**不支持"排除某角色"**（避免出现自相矛盾的权限表）。
//
// 单一事实来源：本文件是能力清单的唯一出处，`/api/ai/status` 与各 AI 接口都从这里取。

/**
 * 版本（决定前端配色与文案；配色值由前端持有，后端只给标识）
 * 顺序 = 优先级：一个用户同时有 admin 与 student 时取 admin 版
 */
export const VARIANT_ORDER = ['admin', 'leader', 'counselor', 'standard'];

export const VARIANT_META = {
  standard: { label: '标准版', desc: '校园问答 · 图书检索' },
  counselor: { label: '审批版', desc: '标准版 + AI 审批助手' },
  leader: { label: '校领导版', desc: '标准版 + 全校信息问数（只读）' },
  admin: { label: '管理员版', desc: '全部能力 + 对话式系统管理' },
};

/**
 * 能力目录
 * @property {string}   key    能力标识（前端渲染与 features 对象的键）
 * @property {string}   label  中文名
 * @property {string[]|null} roles 需要的角色（null = 全部登录用户）
 * @property {string}   config sys_config 里的开关键
 * @property {'1'|'0'}  def    开关缺省值
 * @property {'read'|'write'} mode 只读 / 可写（前端据此给"安全提示"样式）
 */
export const FEATURES = [
  { key: 'chat', label: '校园智能问答', roles: null, config: 'ai.chat.enabled', def: '1', mode: 'read' },
  { key: 'libSearch', label: '图书自然语言检索', roles: null, config: 'ai.lib_search.enabled', def: '1', mode: 'read' },
  { key: 'study', label: '学业助手', roles: ['student'], config: 'ai.study.enabled', def: '1', mode: 'read' },
  { key: 'triage', label: '报修智能分诊', roles: null, config: 'ai.triage.enabled', def: '0', mode: 'read' },
  { key: 'approvalAdvice', label: 'AI 审批助手', roles: ['counselor', 'admin'], config: 'ai.approval_advice.enabled', def: '0', mode: 'read' },
  // C6 模板问数 + C13 自由结构化查询共用这一个开关与能力项（两者是同一条链路的两种表达）
  { key: 'insight', label: '信息问数与自由统计', roles: ['leader', 'admin'], config: 'ai.insight.enabled', def: '1', mode: 'read' },
  { key: 'adminAction', label: '智能系统管理', roles: ['admin'], config: 'ai.admin_console.enabled', def: '1', mode: 'write' },
  { key: 'adminConsole', label: 'AI 管理控制台', roles: ['admin'], config: 'ai.admin_console.enabled', def: '1', mode: 'write' },
];

/**
 * 某能力是否对该角色组开放（roles 为空 = 全员）
 * ★ 防御式默认拒绝：`roles` 为空数组时一律返回 false。
 *   正常链路里 `requireRoles` 已挡掉"无角色"用户，但权限函数不能依赖调用方守规矩——
 *   否则将来某处漏了鉴权，`roles:null` 的全员能力就会对匿名请求开放。
 */
export function featureAllowed(feature, roles = []) {
  if (!Array.isArray(roles) || roles.length === 0) return false;
  return !feature.roles || feature.roles.some((r) => roles.includes(r));
}

/** 角色 → 版本标识 */
export function variantOf(roles = []) {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('leader')) return 'leader';
  if (roles.includes('counselor')) return 'counselor';
  return 'standard';
}

/**
 * 解析出该角色**可见**的能力开关快照
 * @param {string[]} roles
 * @param {Record<string,string>} cfg sys_config 全量键值
 * @param {boolean} configured AI 是否已配置（未配置时全部视为不可用，前端隐藏入口）
 * @returns {Record<string,boolean>}
 */
export function resolveFeatures(roles, cfg = {}, configured = true) {
  const out = {};
  for (const f of FEATURES) {
    if (!featureAllowed(f, roles)) continue;
    const raw = Object.prototype.hasOwnProperty.call(cfg, f.config) ? String(cfg[f.config]) : f.def;
    out[f.key] = configured && (raw === '1' || raw.toLowerCase() === 'true');
  }
  return out;
}

/** 该角色组可用的能力目录（带中文名与只读/可写标记，供前端渲染功能列表） */
export function featureCatalog(roles, features = {}) {
  return FEATURES.filter((f) => featureAllowed(f, roles)).map((f) => ({
    key: f.key,
    label: f.label,
    mode: f.mode,
    on: Boolean(features[f.key]),
  }));
}

/** 候选问题（点一下直接发问，降低"不知道能问什么"的门槛） */
const SUGGESTIONS = {
  common: [
    '清北大学有哪些院系和行政部门？',
    '怎么选课？选课什么时候开放？',
    '我要请假，流程是什么？',
    '图书馆能借几本书？借多久？',
    '宿舍报修怎么提交？多久能修好？',
    '忘记登录密码了怎么办？',
  ],
  counselor: ['请假审批要注意哪些点？', '本院学生名册怎么导出？', '报修工单的四种状态分别代表什么？'],
  leader: [
    '这周哪个班级请假人数最多？',
    '全校各院系本月请假天数排名',
    '本学期选课人数最多的五门课',
    '宿舍入住率最高的院系',
    '报修平均处理时长是多少？',
  ],
  admin: [
    '禁用账号 student01',
    '查看所有待审批的请假',
    '批准陈晓东的请假申请',
    '本周全校请假数据概览',
    '论坛有哪些待复核的内容？',
  ],
};

/**
 * 按版本给出候选问题：先给"本版本专属"，不足 6 条再用通用问题补齐
 * @returns {string[]}
 */
export function suggestionsFor(variant = 'standard', limit = 6) {
  const own = SUGGESTIONS[variant] || [];
  const mixed = [...own, ...SUGGESTIONS.common];
  return mixed.slice(0, Math.max(1, limit));
}
