// node-functions/lib/ai-insight.js — C6 信息问数（校领导 / 管理员）
//
// ★ 核心安全设计：**模型永远不接触 SQL**。
//   模型只做一件事：把用户的话映射到下面这张**模板白名单** + 抽取参数值；
//   参数值还要过 `enum` 校验（只允许白名单取值），然后由服务端用**参数化 SQL** 执行。
//   即使模型被诱导输出了 `'; DROP TABLE` 之类的内容，也只会被 enum 校验挡掉
//   （day 值不在白名单里 → 49402），永远进不了 SQL 文本。
//
// 时间口径（铁律 #25）：库内是 UTC 墙钟，因此窗口一律写成 `NOW() - INTERVAL ? DAY`，
//   **不引入北京时区换算**——统计口径是"近 N 天"，不是"自然周"，避免了口径歧义
//   （所以参数值刻意标成「近7天」而不是「本周」，不给自己挖坑）。
//
// 数据范围：本模块只给 leader/admin 使用（全校只读），不做 dept 过滤；
//   如需给辅导员开放，必须补 `dataScope` 过滤，否则会越权看到全院/全校数据。
import { HttpError } from './guard.js';
import { query } from './db.js';
import { hasRole } from './services/_actor.js';
// 问法解析要用到模型与知识库（"不是问数需求时用同一份知识库作答"）
import { aiJson, logAiUsage } from './ai.js';
import { buildAnswerSystem } from './ai-prompt.js';
import { KB_PROFILE, buildKnowledgeContext } from './ai-kb.js';
import { identityBlock, loadIdentity } from './ai-identity.js';

const ROLES = ['leader', 'admin'];

/** 允许的时间窗口（模型只能选这里的值；`all` 表示不加时间条件） */
const PERIODS = {
  '7d': { label: '近 7 天', days: 7 },
  '30d': { label: '近 30 天', days: 30 },
  '180d': { label: '近 180 天（约一个学期）', days: 180 },
  all: { label: '全部时间', days: 0 },
};

const periodDesc = `时间范围，可选值：${Object.entries(PERIODS).map(([k, v]) => `${k}=${v.label}`).join('，')}`;

/** 生成时间条件片段（days 来自枚举校验过的白名单，不是模型原文） */
function periodSql(days, col = 'created_at') {
  return days > 0 ? ` AND ${col} > NOW() - INTERVAL ${Number(days)} DAY` : '';
}

/** 取窗口天数（白名单校验） */
function periodDays(p) {
  const k = String(p || '30d');
  if (!Object.prototype.hasOwnProperty.call(PERIODS, k)) {
    throw new HttpError(49402, `时间范围必须是 ${Object.keys(PERIODS).join(' / ')} 之一`);
  }
  return PERIODS[k].days;
}

/**
 * 模板注册表 —— 唯一事实来源
 * @property {string} key
 * @property {string} label
 * @property {string} desc 给模型看
 * @property {object} params 参数 schema（enum 会被严格校验）
 * @property {(ctx:{days:number, period:string, periodLabel:string}, p:object) => Promise<{rows:object[], summary:string}>} run
 */
export const TEMPLATES = {
  leave_top_classes: {
    label: '各班请假人数排名',
    desc: '统计请假人数最多的班级（按请假单条数），用于回答"哪个班请假最多"',
    params: { period: { type: 'enum', values: Object.keys(PERIODS), desc: periodDesc }, limit: { type: 'enum', values: ['5', '10', '20'], desc: '返回前几名，默认 10' } },
    run: async (ctx, p) => {
      const days = ctx.days;
      const limit = ['5', '10', '20'].includes(String(p.limit)) ? Number(p.limit) : 10;
      const rows = await query(
        `SELECT cl.name AS 班级, d.name AS 院系, COUNT(*) AS 请假人次, COUNT(DISTINCT l.student_id) AS 涉及人数
           FROM af_leave l
           JOIN sys_user u ON u.id = l.student_id
           LEFT JOIN sys_class cl ON cl.id = u.class_id
           LEFT JOIN sys_department d ON d.id = u.dept_id
          WHERE 1 = 1${periodSql(days, 'l.created_at')}
          GROUP BY cl.id, cl.name, d.name
          ORDER BY 请假人次 DESC, 涉及人数 DESC
          LIMIT ${limit}`,
      );
      const top = rows[0];
      return {
        rows,
        summary: top
          ? `${ctx.periodLabel}请假最多的是 ${top.班级 || '（未分班）'}（${top.院系 || '-'}），${top.请假人次} 人次、涉及 ${top.涉及人数} 人。`
          : '该时间范围内没有请假记录。',
      };
    },
  },

  leave_dept_rank: {
    label: '各院系请假情况排名',
    desc: '按院系统计请假单数与合计请假天数',
    params: { period: { type: 'enum', values: Object.keys(PERIODS), desc: periodDesc } },
    run: async (ctx) => {
      const days = ctx.days;
      const rows = await query(
        `SELECT d.name AS 院系, COUNT(*) AS 请假单数,
                ROUND(SUM(TIMESTAMPDIFF(HOUR, l.start_at, l.end_at)) / 24, 1) AS 合计天数,
                COUNT(DISTINCT l.student_id) AS 涉及人数
           FROM af_leave l
           LEFT JOIN sys_department d ON d.id = l.dept_id
          WHERE 1 = 1${periodSql(days, 'l.created_at')}
          GROUP BY d.id, d.name
          ORDER BY 合计天数 DESC
          LIMIT 20`,
      );
      return { rows, summary: rows.length ? `共 ${rows.length} 个院系有请假记录，天数最多的是 ${rows[0].院系 || '（未归属）'}（${rows[0].合计天数} 天）。` : '该时间范围内没有请假记录。' };
    },
  },

  leave_overview: {
    label: '请假总览（按类型与状态）',
    desc: '请假单按类型和审批状态的数量分布',
    params: { period: { type: 'enum', values: Object.keys(PERIODS), desc: periodDesc } },
    run: async (ctx) => {
      const days = ctx.days;
      const rows = await query(
        `SELECT type AS 请假类型,
                COUNT(*) AS 总数,
                SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS 审批中,
                SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS 已批准,
                SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) AS 已驳回,
                SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) AS 已销假
           FROM af_leave
          WHERE 1 = 1${periodSql(days, 'created_at')}
          GROUP BY type ORDER BY 总数 DESC`,
      );
      const total = rows.reduce((n, r) => n + Number(r.总数 || 0), 0);
      return { rows, summary: `共 ${total} 条请假单。` };
    },
  },

  course_top: {
    label: '选课人数最多的教学班',
    desc: '按已选人数排名的教学班（课程/教师/上课时间）',
    params: { limit: { type: 'enum', values: ['5', '10', '20'], desc: '返回前几名，默认 10' } },
    run: async (_ctx, p) => {
      const limit = ['5', '10', '20'].includes(String(p.limit)) ? Number(p.limit) : 10;
      const rows = await query(
        `SELECT c.name AS 课程, t.real_name AS 任课教师, ec.term AS 学期,
                ec.enrolled AS 已选人数, ec.capacity AS 容量,
                CONCAT('周', ec.week_day, ' ', ec.section, ' ', IFNULL(ec.classroom, '')) AS 上课安排
           FROM edu_class ec
           JOIN edu_course c ON c.id = ec.course_id
           LEFT JOIN sys_user t ON t.id = ec.teacher_id
          WHERE ec.status = 1
          ORDER BY ec.enrolled DESC
          LIMIT ${limit}`,
      );
      return { rows, summary: rows.length ? `选课人数最多的是《${rows[0].课程}》（${rows[0].已选人数}/${rows[0].容量} 人）。` : '暂无教学班数据。' };
    },
  },

  score_distribution: {
    label: '成绩等级分布',
    desc: '已出成绩的教学班按等级（优秀/良好/中等/及格/不及格）统计',
    params: { limit: { type: 'enum', values: ['10', '20', '50'], desc: '统计前多少个教学班，默认 20' } },
    run: async (_ctx, p) => {
      const limit = ['10', '20', '50'].includes(String(p.limit)) ? Number(p.limit) : 20;
      const rows = await query(
        `SELECT c.name AS 课程, COUNT(*) AS 已出成绩人数,
                ROUND(AVG(e.score), 1) AS 平均分,
                SUM(CASE WHEN e.score >= 90 THEN 1 ELSE 0 END) AS 优秀,
                SUM(CASE WHEN e.score >= 80 AND e.score < 90 THEN 1 ELSE 0 END) AS 良好,
                SUM(CASE WHEN e.score >= 70 AND e.score < 80 THEN 1 ELSE 0 END) AS 中等,
                SUM(CASE WHEN e.score >= 60 AND e.score < 70 THEN 1 ELSE 0 END) AS 及格,
                SUM(CASE WHEN e.score < 60 THEN 1 ELSE 0 END) AS 不及格
           FROM edu_elect e
           JOIN edu_class ec ON ec.id = e.class_id
           JOIN edu_course c ON c.id = ec.course_id
          WHERE e.score IS NOT NULL
          GROUP BY c.id, c.name
          ORDER BY 已出成绩人数 DESC
          LIMIT ${limit}`,
      );
      return { rows, summary: rows.length ? `已出成绩的教学班 ${rows.length} 个，平均分最高的是《${rows[0].课程}》（${rows[0].平均分}）。` : '暂无已出成绩的记录。' };
    },
  },

  dorm_occupancy: {
    label: '宿舍入住情况',
    desc: '按楼栋统计床位数、已住与入住率',
    params: {},
    run: async () => {
      const rows = await query(
        `SELECT b.name AS 楼栋, b.gender AS 性别,
                COUNT(r.id) AS 房间数,
                SUM(r.capacity) AS 总床位,
                SUM(r.occupied) AS 已住床位,
                CONCAT(ROUND(SUM(r.occupied) / NULLIF(SUM(r.capacity), 0) * 100, 1), '%') AS 入住率
           FROM dorm_building b
           LEFT JOIN dorm_room r ON r.building_id = b.id
          GROUP BY b.id, b.name, b.gender
          ORDER BY SUM(r.occupied) DESC`,
      );
      const tot = rows.reduce((a, r) => ({ cap: a.cap + Number(r.总床位 || 0), occ: a.occ + Number(r.已住床位 || 0) }), { cap: 0, occ: 0 });
      return {
        rows,
        summary: `全校共 ${tot.cap} 个床位、已住 ${tot.occ} 个，整体入住率 ${tot.cap ? Math.round((tot.occ / tot.cap) * 1000) / 10 : 0}%。`,
      };
    },
  },

  repair_stats: {
    label: '报修工单统计',
    desc: '报修单按状态分布 + 平均处理时长',
    params: { period: { type: 'enum', values: Object.keys(PERIODS), desc: periodDesc } },
    run: async (ctx) => {
      const days = ctx.days;
      const rows = await query(
        `SELECT CASE status WHEN 0 THEN '待受理' WHEN 1 THEN '处理中' WHEN 2 THEN '已完成' WHEN 3 THEN '无法处理' ELSE '未知' END AS 状态,
                COUNT(*) AS 数量
           FROM af_repair
          WHERE 1 = 1${periodSql(days, 'created_at')}
          GROUP BY status ORDER BY status`,
      );
      const done = rows.find((r) => r.状态 === '已完成');
      const avg = await query(
        `SELECT ROUND(AVG(TIMESTAMPDIFF(HOUR, created_at, updated_at)), 1) AS h
           FROM af_repair
          WHERE status = 2${periodSql(days, 'created_at')}`,
      );
      const total = rows.reduce((n, r) => n + Number(r.数量 || 0), 0);
      return {
        rows,
        summary: `共 ${total} 条报修单，其中已完成 ${done?.数量 || 0} 条；已完成的平均处理时长约 ${avg[0]?.h ?? 0} 小时。`,
      };
    },
  },

  forum_activity: {
    label: '论坛活跃度',
    desc: '按板块统计主题帖与回复数，并列出最活跃的用户',
    params: { period: { type: 'enum', values: Object.keys(PERIODS), desc: periodDesc } },
    run: async (ctx) => {
      const days = ctx.days;
      const boards = await query(
        `SELECT b.name AS 板块, COUNT(*) AS 主题帖数,
                SUM(t.reply_count) AS 回复数
           FROM forum_thread t
           JOIN forum_board b ON b.id = t.board_id
          WHERE t.status = 1${periodSql(days, 't.created_at')}
          GROUP BY b.id, b.name ORDER BY 主题帖数 DESC`,
      );
      const users = await query(
        `SELECT u.real_name AS 用户, COUNT(*) AS 发帖数
           FROM forum_thread t JOIN sys_user u ON u.id = t.author_id
          WHERE t.status = 1${periodSql(days, 't.created_at')}
          GROUP BY u.id, u.real_name ORDER BY 发帖数 DESC LIMIT 5`,
      );
      const total = boards.reduce((n, r) => n + Number(r.主题帖数 || 0), 0);
      return {
        rows: boards,
        extra: { 最活跃用户: users },
        summary: `该时间范围内共有 ${total} 个主题帖，最活跃板块是「${boards[0]?.板块 || '-'}」。`,
      };
    },
  },

  user_stats: {
    label: '账号统计',
    desc: '账号总数、按角色与状态分布',
    params: {},
    run: async () => {
      const byRole = await query(
        `SELECT r.name AS 角色, COUNT(*) AS 人数
           FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
           JOIN sys_user u ON u.id = ur.user_id
          GROUP BY r.id, r.name ORDER BY 人数 DESC`,
      );
      const byStatus = await query(
        `SELECT CASE status WHEN 1 THEN '正常' ELSE '已禁用' END AS 状态, COUNT(*) AS 数量
           FROM sys_user GROUP BY status`,
      );
      const [[{ n }]] = [await query('SELECT COUNT(*) AS n FROM sys_user')];
      return {
        rows: byRole,
        extra: { 按状态: byStatus },
        summary: `全校共 ${n} 个账号；拥有管理员角色的 ${byRole.find((r) => r.角色 === '管理员')?.人数 ?? 0} 人。`,
      };
    },
  },

  login_trend: {
    label: '登录趋势',
    desc: '近 N 天每日登录次数与去重用户数',
    params: { period: { type: 'enum', values: Object.keys(PERIODS), desc: periodDesc } },
    run: async (ctx) => {
      const d = ctx.days > 0 ? ctx.days : 30;
      const rows = await query(
        `SELECT DATE(created_at) AS 日期, COUNT(*) AS 登录次数, COUNT(DISTINCT user_id) AS 去重人数
           FROM sys_login_log
          WHERE success = 1 AND created_at > NOW() - INTERVAL ${d} DAY
          GROUP BY DATE(created_at) ORDER BY 日期 DESC LIMIT 60`,
      );
      return { rows, summary: `近 ${d} 天有 ${rows.length} 天产生登录记录，最近一天登录 ${rows[0]?.登录次数 ?? 0} 次。` };
    },
  },
};

/** 该角色能否问数 */
export const canInsight = (actor) => hasRole(actor, ROLES);

/** 模板目录（管理页/前端展示） */
export function insightCatalog(actor) {
  if (!canInsight(actor)) return [];
  return Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, desc: t.desc, params: Object.keys(t.params) }));
}

/** 组装给模型的模板说明（含参数白名单，减少幻觉） */
export function insightPromptFor(actor) {
  if (!canInsight(actor)) return '（当前角色没有问数权限）';
  return Object.entries(TEMPLATES)
    .map(([key, t]) => {
      const ps = Object.entries(t.params)
        .map(([k, v]) => `      ${k}: ${v.desc}${v.type === 'enum' ? `（严格限定：${v.values.join(' / ')}）` : ''}`)
        .join('\n');
      return `- ${key}【${t.label}】${t.desc}${ps ? `\n${ps}` : '\n      （无参数）'}`;
    })
    .join('\n');
}

/**
 * 执行一个模板
 * @param {object} actor
 * @param {string} key
 * @param {object} params 参数（会做 enum 校验）
 */
export async function runInsight(actor, key, params = {}) {
  if (!canInsight(actor)) throw new HttpError(49403, '你的角色没有问数权限', 403);
  const t = TEMPLATES[key];
  if (!t) throw new HttpError(49402, '无法识别的问数模板');

  // 参数校验：只保留 schema 里声明过的键，enum 必须命中白名单（**这一步是 SQL 注入的最后一道闸**）
  const clean = {};
  for (const [k, def] of Object.entries(t.params)) {
    const raw = params[k];
    if (raw === undefined || raw === null || raw === '') continue;
    if (def.type === 'enum') {
      const v = String(raw);
      if (!def.values.includes(v)) throw new HttpError(49402, `参数 ${k} 只能是 ${def.values.join(' / ')}`);
      clean[k] = v;
    } else {
      clean[k] = String(raw).slice(0, 32);
    }
  }
  const period = clean.period ?? '30d';
  const ctx = { days: periodDays(period), period, periodLabel: PERIODS[period].label };
  const out = await t.run(ctx, clean);
  return {
    template: key,
    label: t.label,
    params: { period: clean.period ?? '30d', ...clean },
    periodLabel: PERIODS[clean.period ?? '30d'].label,
    rows: out.rows || [],
    extra: out.extra || null,
    summary: out.summary || '',
  };
}

// ============================================================
// 问法解析（从 api/ai/insight.js 抽到这里）
//
// 为什么必须抽出来：**评估要跑真实链路**。若评估脚本自己复制一份解析
// 提示词，那就变成"测另一套实现"，指标毫无意义（而且两份提示词必然漂移）。
// 现在接口与评估共用同一个函数，评估量出的就是线上真实的行为。
// ============================================================

const PARSE_RULES = [
  '你是「智汇校园」平台的**数据问数解析器**。任务：把用户的问题映射到下方【可用问数模板】。',
  '',
  '【输出格式】严格输出 JSON，不要任何解释文字：',
  '{"template":"<模板 key 或 null>","params":{...},"reply":"<仅当 template=null 时填写>"}',
  '',
  '【硬性规则】',
  '1. template 必须是下方列出的 key 之一；**不确定就填 null**，绝不编造。',
  '2. params 里的枚举值**只能取括号中列出的值**，不要自造（例如时间范围只能填 7d / 30d / 180d / all）。',
  '3. 用户只是在问制度、流程、校园情况（不是要统计数据）时，template 填 null，reply 里按下方【资料】回答。',
  '4. 不要输出 SQL，也不要描述你打算怎么查——只选模板。',
].join('\n');

const FINAL_JUDGE = [
  '【最终判定】先判断用户是不是在**要统计数据**：',
  '- 是 → 输出 template + params，reply 留空。',
  '- 不是 → template 填 null，reply 里正常回答用户的问题（当作校园助手）。',
].join('\n');

/**
 * 把一句话解析成"模板 + 参数"（失败返回 null）
 *
 * @returns {Promise<{template:string|null, params:object, reply:string, sources:Array}|null>}
 *   `null` = 上游未响应（调用方应回"稍后再试"）；`template: null` = 这不是问数需求，
 *   此时 `reply` 是正常回答、`sources` 是引用到的知识条目。
 */
export async function pickTemplate(actor, text) {
  const identity = await loadIdentity(actor.userId);
  const kb = await buildKnowledgeContext(text, { inlineMaxChars: 4000, topK: 5, minScore: 3, minRatio: 0.25 });
  const system = buildAnswerSystem({
    identityText: identityBlock(identity, actor.roles),
    kbProfile: KB_PROFILE,
    kbText: kb.text,
    extraTop: [PARSE_RULES, '', '【可用问数模板】', insightPromptFor(actor), '', FINAL_JUDGE].join('\n'),
  });

  const t0 = Date.now();
  const parsed = await aiJson({ system, user: text, maxTokens: 400, temperature: 0, timeoutMs: 8000, totalBudgetMs: 9000 });
  await logAiUsage({
    userId: actor.userId,
    kind: 'insight',
    promptTokens: parsed?._usage?.prompt_tokens ?? 0,
    completionTokens: parsed?._usage?.completion_tokens ?? 0,
    ok: parsed ? 1 : 0,
    costMs: Date.now() - t0,
  });
  if (!parsed) return null;

  return {
    template: parsed.template == null ? null : String(parsed.template),
    params: parsed.params && typeof parsed.params === 'object' ? parsed.params : {},
    reply: String(parsed.reply || ''),
    sources: kb.sources || [],
  };
}
