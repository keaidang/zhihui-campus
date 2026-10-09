// node-functions/lib/ai-entity.js —— 通用查询的「实体字段注册表」
//
// ── 它解决什么问题 ────────────────────────────────────────────────────
// 改造前（lib/ai-insight.js 的模板方案）：模型只能从 10 个固定模板里选，
// 于是「当前系统中学生账号的数量」只能退化成"列出 50 条明细" ——
// 用户想看一个数，系统给一张 50 行的表。能力上限 = 模板数量，这是设计天花板。
//
// 改造后（本文件 + lib/ai-query.js）：模型输出**结构化查询描述**
//   { entity, metrics, groupBy, filters, orderBy, limit }
// 服务端用它编译成参数化 SQL。于是"任意 聚合 × 分组 × 筛选 × 排序"组合都能表达，
// 而模型**仍然不碰 SQL 文本**。
//
// ── 安全边界（为什么这不等于"让模型写 SQL"）────────────────────────────
// 1. 模型能产出的**只有本文件里的 key**。字段名由本文件定义，模型写 `real_name`
//    还是 `username` 都只是 key；任何不在表里的 key 一律拒绝。
// 2. 每个 key 对应的 SQL 片段由**本文件写死**（如 `username` → `u.username`），
//    模型无法自定义片段、无法写别名、无法拼表达式。
// 3. 值一律走 `?` 占位符（lib/ai-query.js 保证），模型给什么都只是参数。
// 4. `scope` 由服务端按角色**强制注入**，模型完全无法干预（它甚至不知道有这回事）。
// 5. 行数硬上限（`LIMIT_HINT`），模型给多大都夹住。
//
// ── 与既有能力的关系（不是替代，是补位）───────────────────────────────
// · 复杂多表统计（"哪个班请假最多"要 join 4 张表算涉及人数）→ 仍走 ai-insight 模板，
//   表达力更强且已验证。
// · 简单聚合/分组/排序（"总数""按院系分组排名"）→ 走本文件 + ai-query。
// 两者都覆盖不到的问题（写操作、跨实体自由组合）→ 都到不了。

import { HttpError } from './guard.js';
import { hasRole } from './services/_actor.js';

/** 筛选操作符白名单：模型只能用这些，不允许自由写 SQL 运算符 */
export const OPS = Object.freeze({
  eq: '等于',
  ne: '不等于',
  gt: '大于',
  gte: '大于等于',
  lt: '小于',
  lte: '小于等于',
  like: '包含',
  in: '属于（值须为数组）',
});

/** 聚合函数白名单 */
export const AGGS = Object.freeze(['COUNT', 'AVG', 'SUM', 'MIN', 'MAX', 'COUNT_DISTINCT']);

/** 行数硬上限（模型给再大也夹住；单值查询不需要 limit） */
export const LIMIT_HINT = { detail: 20, aggregate: 10, max: 50 };

/**
 * 字段定义辅助
 * @param {string} key       模型可见的字段名（白名单 key）
 * @param {string} sql       SQL 片段（**本文件写死**，模型不可干预）
 * @param {string} label     中文显示名
 * @param {object} [o]
 * @param {'num'|'str'|'time'|'enum'} [o.type='str'] num 才能排序/做数学比较
 * @param {string[]} [o.values] 枚举可选值（模型必须从里面选）
 * @param {boolean} [o.groupable=false] 能否作为 GROUP BY 维度
 * @param {boolean} [o.identity=false]   是否为"实体标识"（明细查询时默认展示）
 * @param {string} [o.hint]  给模型看的说明，提升抽取准确率
 */
const f = (key, sql, label, o = {}) => ({
  key,
  sql,
  label,
  type: o.type || 'str',
  values: o.values || null,
  groupable: Boolean(o.groupable),
  identity: Boolean(o.identity),
  hint: o.hint || '',
});

// ============================================================
// 实体定义
// ============================================================
// scope.kind 的含义（由 lib/ai-query.js 强制注入，模型无法干预）：
//   all    → 不额外限制（仅 admin / leader 可见）
//   dept   → 限定 actor.deptId（辅导员）
//   self   → 限定 actor.userId（学生本人）

export const ENTITIES = Object.freeze({
  // ----------------------------------------------------------
  user: {
    label: '账号',
    desc: '系统里的学生 / 教师 / 辅导员 / 校领导 / 管理员账号',
    roles: ['admin', 'counselor', 'leader', 'teacher'],
    scope: { kind: 'byRole', adminAll: true },
    base: 'sys_user u',
    joins: [
      'LEFT JOIN sys_class cl ON cl.id = u.class_id',
      'LEFT JOIN sys_department dp ON dp.id = cl.dept_id',
      'LEFT JOIN sys_user_role ur ON ur.user_id = u.id',
      'LEFT JOIN sys_role rl ON rl.id = ur.role_id',
    ],
    // 实体主键所在的表别名，供 scope 注入与"去重"用
    primaryAlias: 'u',
    fields: {
      username: f('username', 'u.username', '账号', { identity: true, groupable: true, hint: '登录用的账号名，如 student01' }),
      realName: f('realName', 'u.real_name', '姓名', { identity: true, groupable: true, hint: '真实姓名，如 陈晓东' }),
      role: f('role', 'rl.code', '角色', { type: 'enum', values: ['student', 'teacher', 'counselor', 'leader', 'admin'], groupable: true, hint: '学生的角色码是 student' }),
      dept: f('dept', 'dp.name', '院系', { groupable: true, hint: '院系全称，如 计算机科学与技术学院' }),
      className: f('className', 'cl.name', '班级', { groupable: true }),
      status: f('status', 'u.status', '状态', { type: 'enum', values: ['0', '1'], hint: '1=正常 0=已禁用' }),
      createdAt: f('createdAt', 'u.created_at', '注册时间', { type: 'time' }),
      lastLogin: f('lastLogin', 'u.last_login_at', '最后登录', { type: 'time' }),
    },
    // 指标：哪些字段能配哪种聚合
    metrics: {
      count: { sql: 'COUNT(DISTINCT u.id)', label: '人数', type: 'num', forced: true },
    },
    // 明细查询默认展示顺序
    defaultSelect: ['username', 'realName', 'role', 'dept'],
    hints: [
      '要"有多少人"时用 metrics:{count:1}，不要拉明细',
      '按院系/班级分组统计人数时 groupBy:["dept"]',
    ],
  },

  // ----------------------------------------------------------
  score: {
    label: '成绩',
    desc: '学生的课程成绩与绩点（绩点口径见 lib/edu-stats.js）',
    roles: ['admin', 'counselor', 'leader'],
    scope: { kind: 'byRole', adminAll: true },
    base: 'edu_elect e',
    joins: [
      'JOIN edu_class c ON c.id = e.class_id',
      'JOIN edu_course co ON co.id = c.course_id',
      'JOIN sys_user u ON u.id = e.student_id',
      'LEFT JOIN sys_class cl ON cl.id = u.class_id',
      'LEFT JOIN sys_department dp ON dp.id = cl.dept_id',
    ],
    primaryAlias: 'e',
    // 关键：只在"已出成绩"的记录里统计，否则 AVG 会被大量 NULL 拉低
    defaultWhere: ['e.status = 2', 'e.score IS NOT NULL'],
    fields: {
      username: f('username', 'u.username', '账号', { identity: true, groupable: true }),
      realName: f('realName', 'u.real_name', '姓名', { identity: true, groupable: true, hint: '要问"哪个学生"时按这个分组' }),
      course: f('course', 'co.name', '课程', { groupable: true, identity: true, hint: '课程名称，如 高等数学（下）' }),
      credit: f('credit', 'co.credit', '学分', { type: 'num' }),
      score: f('score', 'e.score', '分数', { type: 'num', hint: '百分制分数' }),
      grade: f('grade', 'e.grade', '等级', { type: 'enum', values: ['优秀', '良好', '中等', '及格', '不及格'], groupable: true }),
      dept: f('dept', 'dp.name', '院系', { groupable: true }),
      className: f('className', 'cl.name', '班级', { groupable: true }),
      term: f('term', 'e.term', '学期', { groupable: true, values: ['2026-2027-1'] }),
    },
    metrics: {
      count: { sql: 'COUNT(*)', label: '门数', type: 'num', forced: true },
      avgScore: { sql: 'AVG(e.score)', label: '平均分', type: 'num', hint: '平均百分制分数' },
      maxScore: { sql: 'MAX(e.score)', label: '最高分', type: 'num' },
      minScore: { sql: 'MIN(e.score)', label: '最低分', type: 'num' },
      failCount: { sql: 'SUM(CASE WHEN e.score < 60 THEN 1 ELSE 0 END)', label: '不及格门数', type: 'num', hint: '分数低于 60 分的门数' },
      failRate: { sql: 'ROUND(SUM(CASE WHEN e.score < 60 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2)', label: '不及格率', type: 'num' },
      // ★ 绩点口径与 lib/edu-stats.js 完全一致：Σ(绩点×学分) / Σ(及格课学分)，不及格不计入分母
      gpa: {
        sql: `ROUND(SUM(CASE WHEN e.score >= 90 THEN 4.0 WHEN e.score >= 80 THEN 3.0
                            WHEN e.score >= 70 THEN 2.0 WHEN e.score >= 60 THEN 1.0 ELSE 0 END * co.credit)
                  / NULLIF(SUM(CASE WHEN e.score >= 60 THEN co.credit ELSE 0 END), 0), 2)`,
        label: '绩点',
        type: 'num',
        hint: '4.0 制绩点，不及格不计入分母（与成绩页面口径一致）',
      },
    },
    defaultSelect: ['realName', 'course', 'score', 'credit', 'grade'],
    // 分组粒度限制：GPA 必须按学生算（否则"各班平均绩点"是另一个口径，易误解）
    groupGranularity: { gpa: ['username', 'realName', 'className', 'dept'] },
    hints: [
      '「绩点最差的学生」→ groupBy:["realName"], metrics:{gpa:1}, orderBy:{gpa:"asc"}',
      '「某院系平均分」→ filters:[{field:"dept",op:"eq",value:"计算机科学与技术学院"}], metrics:{avgScore:1}',
      '「挂科最多的学生」→ groupBy:["realName"], metrics:{failCount:1}, orderBy:{failCount:"desc"}',
      '注意：绩点按学生维度计算，若要按班级分组请用 avgScore',
    ],
  },

  // ----------------------------------------------------------
  leave: {
    label: '请假单',
    desc: '学生的请假申请与审批状态',
    roles: ['admin', 'counselor', 'leader'],
    scope: { kind: 'byRole', adminAll: true },
    base: 'af_leave l',
    joins: [
      'JOIN sys_user u ON u.id = l.student_id',
      'LEFT JOIN sys_class cl ON cl.id = u.class_id',
      'LEFT JOIN sys_department dp ON dp.id = cl.dept_id',
    ],
    primaryAlias: 'l',
    fields: {
      username: f('username', 'u.username', '账号', { identity: true, groupable: true }),
      realName: f('realName', 'u.real_name', '姓名', { identity: true, groupable: true }),
      type: f('type', 'l.type', '请假类型', { type: 'enum', values: ['事假', '病假', '其他'], groupable: true }),
      status: f('status', 'l.status', '审批状态', { type: 'enum', values: ['1', '2', '3', '4'], groupable: true, hint: '1=审批中 2=已批准 3=已驳回 4=已销假' }),
      dept: f('dept', 'dp.name', '院系', { groupable: true }),
      className: f('className', 'cl.name', '班级', { groupable: true }),
      days: f('days', 'DATEDIFF(l.end_at, l.start_at) + 1', '请假天数', { type: 'num' }),
      createdAt: f('createdAt', 'l.created_at', '提交时间', { type: 'time' }),
    },
    metrics: {
      count: { sql: 'COUNT(*)', label: '单数', type: 'num', forced: true },
      totalDays: { sql: 'SUM(DATEDIFF(l.end_at, l.start_at) + 1)', label: '总天数', type: 'num' },
      avgDays: { sql: 'ROUND(AVG(DATEDIFF(l.end_at, l.start_at) + 1), 2)', label: '平均天数', type: 'num' },
      people: { sql: 'COUNT(DISTINCT l.student_id)', label: '涉及人数', type: 'num' },
    },
    defaultSelect: ['realName', 'type', 'days', 'status', 'createdAt'],
    hints: ['「哪个班请假最多」→ groupBy:["className"], metrics:{count:1}, orderBy:{count:"desc"}'],
  },

  // ----------------------------------------------------------
  repair: {
    label: '报修工单',
    desc: '学生提交的报修单与处理状态',
    roles: ['admin', 'counselor', 'leader'],
    scope: { kind: 'byRole', adminAll: true },
    base: 'af_repair r',
    joins: ['JOIN sys_user u ON u.id = r.user_id'],
    primaryAlias: 'r',
    fields: {
      username: f('username', 'u.username', '账号', { identity: true, groupable: true }),
      location: f('location', 'r.location', '报修位置', { groupable: true }),
      category: f('category', 'r.category', '故障类别', { type: 'enum', values: ['水电', '家具', '网络', '门锁', '其他'], groupable: true }),
      status: f('status', 'r.status', '处理状态', { type: 'enum', values: ['0', '1', '2', '3'], groupable: true, hint: '0=待受理 1=处理中 2=已完成 3=无法处理' }),
      description: f('description', 'r.description', '故障描述'),
      createdAt: f('createdAt', 'r.created_at', '提交时间', { type: 'time' }),
    },
    metrics: {
      count: { sql: 'COUNT(*)', label: '工单数', type: 'num', forced: true },
      pending: { sql: 'SUM(CASE WHEN r.status = 0 THEN 1 ELSE 0 END)', label: '待受理数', type: 'num' },
    },
    defaultSelect: ['location', 'category', 'status', 'createdAt'],
    hints: ['「哪类故障最多」→ groupBy:["category"], metrics:{count:1}'],
  },

  // ----------------------------------------------------------
  loan: {
    label: '图书借阅',
    desc: '学生的图书借阅与归还记录',
    roles: ['admin', 'counselor', 'leader'],
    scope: { kind: 'byRole', adminAll: true },
    base: 'lib_loan ln',
    joins: [
      'JOIN lib_book b ON b.id = ln.book_id',
      'JOIN sys_user u ON u.id = ln.user_id',
    ],
    primaryAlias: 'ln',
    fields: {
      username: f('username', 'u.username', '账号', { identity: true, groupable: true }),
      realName: f('realName', 'u.real_name', '姓名', { identity: true, groupable: true }),
      bookTitle: f('bookTitle', 'b.title', '书名', { groupable: true, identity: true }),
      category: f('category', 'b.category', '图书分类', { type: 'enum', groupable: true, values: ['计算机', 'AI', '金融', '文学', '历史', '科学', '艺术', '教育', '综合'] }),
      status: f('status', 'ln.status', '借阅状态', { type: 'enum', values: ['0', '1', '2'], groupable: true, hint: '0=借出中 1=已归还 2=逾期归还' }),
      borrowedAt: f('borrowedAt', 'ln.borrowed_at', '借出时间', { type: 'time' }),
      dueAt: f('dueAt', 'ln.due_at', '应还时间', { type: 'time' }),
    },
    metrics: {
      count: { sql: 'COUNT(*)', label: '借阅次数', type: 'num', forced: true },
      overdue: { sql: 'SUM(CASE WHEN ln.status = 0 AND ln.due_at < NOW() THEN 1 ELSE 0 END)', label: '逾期未还数', type: 'num', hint: '当前仍借出且已过应还日期' },
    },
    defaultSelect: ['realName', 'bookTitle', 'borrowedAt', 'dueAt', 'status'],
    hints: ['「谁借书最多」→ groupBy:["realName"], metrics:{count:1}', '「逾期未还有多少」→ metrics:{overdue:1}，不分组直接给总数'],
  },

  // ----------------------------------------------------------
  forum: {
    label: '论坛',
    desc: '校园论坛的主题与互动情况',
    roles: ['admin', 'counselor', 'leader'],
    scope: { kind: 'byRole', adminAll: true },
    base: 'forum_thread t',
    joins: [
      'JOIN forum_board b ON b.id = t.board_id',
      'JOIN sys_user u ON u.id = t.author_id',
    ],
    primaryAlias: 't',
    defaultWhere: ['t.status = 1'],
    fields: {
      title: f('title', 't.title', '标题', { identity: true, groupable: true }),
      board: f('board', 'b.name', '板块', { groupable: true }),
      author: f('author', 'u.real_name', '作者', { groupable: true }),
      reviewStatus: f('reviewStatus', 't.review_status', '审核状态', { type: 'enum', values: ['0', '1', '2'], groupable: true, hint: '0=正常 1=待复核 2=已下架' }),
      replyCount: f('replyCount', 't.reply_count', '回复数', { type: 'num' }),
      createdAt: f('createdAt', 't.created_at', '发布时间', { type: 'time' }),
    },
    metrics: {
      count: { sql: 'COUNT(*)', label: '主题数', type: 'num', forced: true },
      replySum: { sql: 'SUM(t.reply_count)', label: '回复总数', type: 'num' },
    },
    defaultSelect: ['title', 'board', 'author', 'replyCount', 'createdAt'],
    hints: ['「哪个板块最活跃」→ groupBy:["board"], metrics:{count:1}'],
  },
});

// ============================================================
// 权限与查询
// ============================================================

/** 该角色能否使用这个实体（默认拒绝：不在 roles 里就是不行） */
export function canQueryEntity(entityKey, actor) {
  const e = ENTITIES[entityKey];
  if (!e) return false;
  return hasRole(actor, e.roles);
}

/**
 * 给模型看的实体目录（不含任何 SQL 片段 —— 那些是服务端的事）
 * @param {object} actor
 * @returns {Array<{key:string,label:string,desc:string,fields:Array,metrics:Array,hints:Array}>}
 */
export function entityCatalog(actor) {
  return Object.entries(ENTITIES)
    // 默认拒绝：只有 roles 命中的实体才出现在目录里。
    // 曾写成过 `canQueryEntity(e === undefined ? '' : '', actor) === false ? ...` 这种绕弯判断，
    // 结果正确但没人读得懂 —— 意图过滤，直接调 hasRole。
    .filter(([key]) => canQueryEntity(key, actor))
    .map(([key, e]) => ({
      key,
      label: e.label,
      desc: e.desc,
      fields: Object.values(e.fields).map((x) => ({
        key: x.key,
        label: x.label,
        type: x.type,
        groupable: x.groupable,
        values: x.values,
        hint: x.hint,
      })),
      metrics: Object.entries(e.metrics).map(([k, m]) => ({
        key: k,
        label: m.label,
        hint: m.hint || '',
        forced: Boolean(m.forced),
      })),
      hints: e.hints || [],
    }));
}

/** 取实体定义，不存在或无权则抛 49402（模型据此知道"不能查这个"而不是 500） */
export function requireEntity(entityKey, actor) {
  const key = String(entityKey ?? '');
  const e = ENTITIES[key];
  if (!e) throw new HttpError(49402, `不支持查询「${key}」这个对象，可查：${Object.keys(ENTITIES).join(' / ')}`, 400);
  if (!canQueryEntity(key, actor)) {
    throw new HttpError(49403, `你的角色不能查询「${e.label}」数据`, 403);
  }
  return e;
}

/** 字段白名单校验：不在表里的 key 一律拒绝（模型编字段名就此被挡） */
export function requireField(entity, fieldKey) {
  const key = String(fieldKey ?? '');
  const fd = entity.fields[key];
  if (!fd) {
    throw new HttpError(49402, `「${entity.label}」没有「${key}」这个字段，可选：${Object.keys(entity.fields).join(' / ')}`, 400);
  }
  return fd;
}

/** 指标白名单校验 */
export function requireMetric(entity, metricKey) {
  const key = String(metricKey ?? '');
  const m = entity.metrics[key];
  if (!m) {
    throw new HttpError(49402, `「${entity.label}」没有「${key}」这个统计方式，可选：${Object.keys(entity.metrics).join(' / ')}`, 400);
  }
  return { key, ...m };
}

/** 操作符白名单校验 */
export function requireOp(op) {
  const key = String(op ?? 'eq');
  if (!Object.prototype.hasOwnProperty.call(OPS, key)) {
    throw new HttpError(49402, `不支持的筛选方式「${key}」，可选：${Object.keys(OPS).join(' / ')}`, 400);
  }
  return key;
}

export const ENTITY_KEYS = Object.keys(ENTITIES);
