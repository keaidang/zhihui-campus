// node-functions/lib/ai-query.js —— 结构化查询描述 → 参数化 SQL 的编译器
//
// ── 输入（模型产出，经 ai-entity.js 白名单校验）─────────────────────────
//   { entity, metrics:{count:1,gpa:1}, groupBy:["dept"], filters:[{field,op,value}],
//     orderBy:{field:"gpa",dir:"asc"}, limit:10 }
//
// ── 输出 ──────────────────────────────────────────────────────────────
//   { rows:[{列名:值}], summary:"人话总结", scalar:值|null, sql, params }
//
// ── 安全设计（逐条对应"模型能不能为所欲为"）────────────────────────────
//  1. **标识符全部来自白名单**：SELECT / GROUP BY / ORDER BY 里的每个片段都由
//     ai-entity.js 查表得到，模型给什么 key 都只影响"选哪个已登记的片段"。
//  2. **值全部参数化**：filters 的 value 一律进 `?` 占位符，绝不拼进 SQL 文本。
//  3. **数据范围强制注入**：scope 由服务端按角色拼进 WHERE，模型既看不到也改不掉。
//     ★ 这是最关键的一条：即便模型被诱导输出 filters:[{field:"dept",value:"别人的院系"}]，
//     注入的 scope 条件仍然与它做 AND，**越权在语法上不可能**。
//  4. **行数硬夹**：LIMIT 用 LIMIT_HINT 夹住，模型给 99999 也只给 50。
//  5. **无 JOIN 自由化**：JOIN 片段写死在注册表里，模型不能新增表、不能改连接条件。
//  6. **ORDER BY 白名单**：只能按已登记且 type='num' 的字段排，或指标的显示别名。
//
// ── 为什么不能省掉这层 ─────────────────────────────────────────────────
// 直接让模型写 SQL：注入（`1; DROP TABLE`）、越权（去掉 WHERE 里的 dept 限制）、
// 拖库（无 LIMIT 的全表扫描）三者都可能。
// 这一层的价值就在于：**模型表达力提升了（任意组合），但安全边界一点没松**。

import { query } from './db.js';
import { HttpError } from './guard.js';
import { LIMIT_HINT, requireEntity, requireField, requireMetric, requireOp } from './ai-entity.js';

/**
 * 数据范围强制注入。
 *
 * 复用 lib/guard.js 的 dataScope 口径（不在此处另写一份角色判断，避免与 guard 漂移）：
 *   admin/leader → 全校，不加限制
 *   counselor    → 本院
 * 其他角色     → 本人（学生看自己的成绩/请假）
 *
 * @returns {{sql:string, params:any[]}}
 */
function scopeWhere(entity, actor) {
  const roles = actor?.roles || [];
  // 全校只读：管理员与校领导
  if (roles.includes('admin') || roles.includes('leader')) return { sql: '', params: [] };

  const alias = entity.primaryAlias;
  const base = entity.base;
  const deptId = actor?.deptId ?? -1;
  const userId = actor?.userId ?? -1;

  // 学生 / 教师：只能看本人。
  // ownerCol 的取法：请假表与成绩表用 student_id，账号/报修/借阅表用 user_id。
  const ownerCol =
    base.includes('af_leave') || alias === 'e' ? `${alias}.student_id` : `${alias}.user_id`;

  if (!roles.includes('counselor')) {
    return { sql: ` AND ${ownerCol} = ?`, params: [userId] };
  }

  // 辅导员：本院。
  // ★★★ 这里必须「默认拒绝」——
  //   原实现只对 af_leave / edu_elect 写了本院条件，其余实体落到 `return { sql: '' }`
  //   也就是**不加任何限制 = 全校可见**。于是辅导员问「有多少账号」会拿到全校 490 条
  //   （2026-10-10 本地验证抓到：预期本院 ~91，实际 490）。
  //   安全判断一旦漏了某个分支，后果是"越权"，所以这里改成白名单式：
  //   只有明确支持的实体才给本院条件，其余一律退化为"只看本人"（最保守）。
  if (base.includes('af_leave')) {
    return { sql: ` AND ${alias}.dept_id = ?`, params: [deptId] };
  }
  if (base.includes('edu_elect')) {
    // 经学生 → 班级 → 院系
    return { sql: ' AND dp.id = ?', params: [deptId] };
  }
  if (base.includes('sys_user')) {
    // 经本人 → 班级 → 院系（u.class_id → cl.dept_id）
    return { sql: ' AND cl.dept_id = ?', params: [deptId] };
  }
  if (base.includes('af_repair') || base.includes('lib_loan')) {
    // 这两张表没有院系字段，只能经提交人所在班级判定
    return { sql: ` AND ${alias}.user_id IN (SELECT id FROM sys_user WHERE class_id IN (SELECT id FROM sys_class WHERE dept_id = ?))`, params: [deptId] };
  }
  if (base.includes('forum_thread')) {
    return { sql: ` AND ${alias}.author_id IN (SELECT id FROM sys_user WHERE class_id IN (SELECT id FROM sys_class WHERE dept_id = ?))`, params: [deptId] };
  }
  // 未登记的实体 → 退化为"只看本人"，绝不退化为"不加限制"
  return { sql: ` AND ${ownerCol} = ?`, params: [userId] };
}

/** 时间窗口：模型给 {field:'createdAt', days:30} 时转成相对条件 */
function timeWhere(fd, spec) {
  const days = Number(spec?.days);
  if (!Number.isFinite(days) || days <= 0 || days > 3660) {
    throw new HttpError(49402, `时间范围必须是 1~3660 天的正整数（收到 ${spec?.days}）`, 400);
  }
  // 库内是 UTC 墙钟（铁律 #25），此处用相对天数避免时区歧义；
  // 参数标注为"近 N 天"而不是"本周"，避免自然周语义歧义。
  return { sql: ` AND ${fd.sql} > NOW() - INTERVAL ? DAY`, params: [days] };
}

/** 单个筛选条件 */
function buildFilter(entity, raw) {
  const fd = requireField(entity, raw?.field);
  const op = requireOp(raw?.op ?? 'eq');

  // 时间筛选的两种形态：{op:'gte', value:'2026-01-01'} 或 {days:30}
  if (fd.type === 'time' && raw?.days !== undefined && op === 'eq') {
    return timeWhere(fd, raw);
  }

  const v = raw?.value;
  if (v === undefined || v === null || v === '') {
    throw new HttpError(49402, `筛选条件「${fd.label}」缺少比较值`, 400);
  }

  // 枚举值校验：模型编一个不存在的枚举（比如 status=9）在此被挡。
  // ★ 必须跳过 `in` 操作符 —— 它的 value 是数组，由下面的 in 分支逐项校验。
  //   原来这里对所有操作符都跑标量比对，导致 `in:['student','teacher']`
  //   被 `String(['student','teacher'])` = "student,teacher" 去匹配枚举表 → 误判为非法值。
  //   表现为"明明给了合法的两个值，却被告知只能填单个值"（2026-10-10 单测抓到）。
  if (op !== 'in' && Array.isArray(fd.values) && !fd.values.map(String).includes(String(v))) {
    throw new HttpError(49402, `「${fd.label}」只能是 ${fd.values.join(' / ')}（收到 ${v}）`, 400);
  }

  // 数值字段的比较值必须是数字 —— 防止把字符串塞进数值比较里做奇怪的事
  if (fd.type === 'num' && op !== 'like' && op !== 'in') {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new HttpError(49402, `「${fd.label}」是数值字段，比较值必须是数字（收到 ${v}）`, 400);
    }
    if (op === 'eq' || op === 'ne') return { sql: ` AND ${fd.sql} = ?`, params: [n] };
    return { sql: ` AND ${fd.sql} ${op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : '<='} ?`, params: [n] };
  }

  switch (op) {
    case 'eq':
    case 'ne':
      return { sql: ` AND ${fd.sql} ${op === 'eq' ? '=' : '<>'} ?`, params: [String(v)] };
    case 'like':
      // LIKE 的通配符由用户控制 → 会变成全表扫描或意外匹配。
      // 即便参数化也不该放行：把 % _ \ 剔除，使其退化为普通包含匹配。
      return { sql: ` AND ${fd.sql} LIKE ?`, params: [`%${String(v).replace(/[%_\\]/g, '')}%`] };
    case 'in': {
      const arr = Array.isArray(v) ? v : String(v).split(/[,，\s]+/);
      if (!arr.length || arr.length > 20) {
        throw new HttpError(49402, `"属于"筛选的值必须是 1~20 个元素的数组`, 400);
      }
      if (Array.isArray(fd.values)) {
        const bad = arr.filter((x) => !fd.values.map(String).includes(String(x)));
        if (bad.length) {
          throw new HttpError(49402, `「${fd.label}」只能是 ${fd.values.join(' / ')}（收到 ${bad.join(', ')}）`, 400);
        }
      }
      const qs = arr.map(() => '?').join(', ');
      return { sql: ` AND ${fd.sql} IN (${qs})`, params: arr.map((x) => (fd.type === 'num' ? Number(x) : String(x))) };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // 时间/字符串字段的顺序比较（字典序对 ISO 日期是正确的）
      const sym = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
      return { sql: ` AND ${fd.sql} ${sym} ?`, params: [String(v)] };
    }
    default:
      throw new HttpError(49402, `不支持的筛选方式「${op}」`, 400);
  }
}

/**
 * 编译成 SQL。
 * @param {object} actor  操作者（决定 scope）
 * @param {object} q      模型产出的查询描述
 * @returns {{sql:string, params:any[], select:Array, groupBy:Array, isAggregate:boolean}}
 */
export function compileQuery(actor, q = {}) {
  const entity = requireEntity(q.entity, actor);

  // ---- 指标 ----
  const metricKeys = Object.keys(q.metrics && typeof q.metrics === 'object' ? q.metrics : {});
  const metrics = metricKeys.length ? metricKeys.map((k) => requireMetric(entity, k)) : [];

  // ---- 分组 ----
  const groupKeys = Array.isArray(q.groupBy) ? q.groupBy : [];
  if (groupKeys.length > 2) {
    throw new HttpError(49402, '一次最多按 2 个维度分组（更复杂的统计请提给我，我用专门的统计模板处理）', 400);
  }
  const groups = groupKeys.map((k) => {
    const fd = requireField(entity, k);
    if (!fd.groupable) {
      throw new HttpError(49402, `「${fd.label}」不能用于分组（可选的分组字段：${Object.values(entity.fields).filter((x) => x.groupable).map((x) => x.key).join(' / ')}）`, 400);
    }
    return fd;
  });

  // ---- 排序 ----
  let orderSql = '';
  const order = q.orderBy && typeof q.orderBy === 'object' ? q.orderBy : null;
  let orderMetricAlias = null; // 记录"按指标排序"，供结果集取别名
  if (order?.field) {
    const dir = String(order.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const asMetric = metrics.find((m) => m.key === order.field);
    if (asMetric) {
      orderMetricAlias = asMetric.label;
      orderSql = ` ORDER BY \`${asMetric.label}\` ${dir}`;
    } else {
      const fd = requireField(entity, order.field);
      if (fd.type !== 'num' && fd.type !== 'time') {
        throw new HttpError(49402, `「${fd.label}」是文本字段，不能用于排序（只能按数值或时间字段排序）`, 400);
      }
      orderSql = ` ORDER BY ${fd.sql} ${dir}`;
    }
  }

  const isAggregate = groups.length > 0 || metrics.length > 0;

  // ---- SELECT ----
  const selectParts = [];
  for (const g of groups) selectParts.push(`${g.sql} AS \`${g.label}\``);
  for (const m of metrics) {
    // forced 指标（count）在聚合查询里总要有；明细查询里不重复展示
    if (!m.forced || isAggregate) selectParts.push(`${m.sql} AS \`${m.label}\``);
  }
  // 既无分组也无指标 → 明细查询：按实体默认展示顺序（或模型指定的 select）
  if (!selectParts.length) {
    const wanted = Array.isArray(q.select) && q.select.length ? q.select : entity.defaultSelect;
    for (const k of wanted.slice(0, 6)) {
      const fd = requireField(entity, k);
      selectParts.push(`${fd.sql} AS \`${fd.label}\``);
    }
  }

  // ---- WHERE ----
  const params = [];
  const wheres = [];
  for (const d of entity.defaultWhere || []) wheres.push(d);
  const filters = Array.isArray(q.filters) ? q.filters.slice(0, 6) : []; // 上限 6 个条件
  for (const raw of filters) {
    const fw = buildFilter(entity, raw);
    wheres.push(fw.sql.replace(/^ AND /, ''));
    params.push(...fw.params);
  }
  // ★ scope 强制注入：放在最后，与模型条件 AND 叠加 —— 模型无法绕过
  const sc = scopeWhere(entity, actor);
  if (sc.sql) {
    wheres.push(sc.sql.replace(/^ AND /, ''));
    params.push(...sc.params);
  }

  // ---- 分组 / 排序 / 限制 ----
  const limit = Math.min(
    LIMIT_HINT.max,
    Math.max(1, Number(q.limit) || (isAggregate ? LIMIT_HINT.aggregate : LIMIT_HINT.detail)),
  );

  const groupSql = groups.length ? ` GROUP BY ${groups.map((g) => g.sql).join(', ')}` : '';
  const havingSql = '';
  // 单值查询（无分组的纯 COUNT）也用 LIMIT 1 兜住
  const limitSql = ` LIMIT ${limit}`;

  // ★ `(entity.joins || [])` 这层兜底不能省：注册表里 forum 实体的 joins 之外，
  //   若将来某个实体不定义 joins，直接 .length 会抛 undefined.length（2026-10-10 踩过）。
  const joinsSql = (entity.joins || []).length ? ` ${entity.joins.join(' ')}` : '';
  const sql = `SELECT ${selectParts.join(', ')} FROM ${entity.base}${joinsSql}${
    wheres.length ? ` WHERE ${wheres.join(' AND ')}` : ''
  }${groupSql}${havingSql}${orderSql}${limitSql}`;

  return { sql, params, select: selectParts, groupBy: groups, metrics, isAggregate, limit, orderMetricAlias };
}

/** 生成人话总结：单值直接给数，多行给"共 N 条 + 首行要点" */
// ★ 注意解构的字段名必须与 compileQuery 的返回值一致：
//   compileQuery 返回的是 **groupBy**（不是 groups）。曾写成解构 `groups`
//   → 运行时 `groups` 为 undefined → `groups.length` 抛 "Cannot read properties of
//   undefined"，13 个用例全挂（2026-10-10）。这种"解构一个不存在的字段"不会在
//   编译期报错，只能靠测试发现 —— 故此处显式注释。
function summarize(entity, { rows, isAggregate, metrics, groupBy }, wanted = 10) {
  const groups = groupBy;
  if (!rows.length) {
    return `没有符合条件的${entity.label}记录。`;
  }
  // 单值：只有一个指标、没有分组 → 直接报数（用户问"多少"时最想看的就是这个）
  if (isAggregate && groups.length === 0 && metrics.length === 1) {
    const m = metrics[0];
    const v = rows[0][m.label];
    if (v === null || v === undefined) return `没有符合条件的${entity.label}记录。`;
    if (m.key === 'count' || m.key === 'people') return `共 ${v} 条${entity.label}记录。`;
    return `${m.label}为 ${v}。`;
  }
  if (isAggregate && groups.length === 1 && metrics.length === 1) {
    const g = groups[0];
    const m = metrics[0];
    const top = rows[0];
    return `共 ${rows.length} 个${g.label}分组，其中${g.label}「${top[g.label]}」的${m.label}最高（${top[m.label]}）。`;
  }
  if (isAggregate) {
    return `共 ${rows.length} 组统计结果，按${
      metrics.map((m) => m.label).join('、')
    }展示。`;
  }
  return `共找到 ${rows.length} 条${entity.label}记录${rows.length >= (wanted || 10) ? `（最多显示 ${wanted} 条）` : ''}。`;
}

/**
 * 执行一次结构化查询。
 * @param {object} actor
 * @param {object} q        模型产出的查询描述
 * @param {object} [opts]
 * @param {number} [opts.wanted] 用户原本问的数量（用于决定是否放宽 limit）
 */
export async function runStructuredQuery(actor, q, opts = {}) {
  const entity = requireEntity(q.entity, actor);
  const compiled = compileQuery(actor, q);
  const rows = await query(compiled.sql, compiled.params);

  // ★ 数值归一化：TiDB 把 DECIMAL/表达式结果按字符串返回（如 "78.29715"、
  //   SUM(...) 返回 "28"），前端直接渲染会显示成字符串、排序也会错。
  //   凡是注册表里声明 type:'num' 的列（指标 label 与数值字段 label）一律转成 Number。
  //   —— 不能在 SQL 里 ROUND 一下就认为完事：SUM/AVG 的返回类型不受 ROUND 控制，
  //   且 COUNT 在部分驱动下也返回字符串。统一在 JS 侧收口，最可靠。
  const numLabels = new Set([
    ...compiled.metrics.filter((m) => m.type === 'num').map((m) => m.label),
    ...Object.values(entity.fields).filter((x) => x.type === 'num').map((x) => x.label),
  ]);
  const normalized = rows.map((r) => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (numLabels.has(k)) {
        const n = Number(v);
        out[k] = Number.isFinite(n) ? n : null;
      } else {
        out[k] = v;
      }
    }
    return out;
  });

  // ★ 必须把 rows 一并传入：compiled 里没有 rows（它是编译产物，不含查询结果）。
  //   曾写成 summarize(entity, compiled, …) → 解构出的 rows 为 undefined → 首行
  //   `rows.length` 直接抛错（2026-10-10，13 个用例全挂）。
  const summary = summarize(entity, { ...compiled, rows: normalized }, opts.wanted || compiled.limit);
  // 单值查询时把数字单独带出去，前端直接显示"共 500 人"而不是表格
  const scalar =
    compiled.isAggregate && compiled.groupBy.length === 0 && compiled.metrics.length === 1
      ? normalized[0]?.[compiled.metrics[0].label] ?? null
      : null;

  return {
    entity: q.entity,
    entityLabel: entity.label,
    isAggregate: compiled.isAggregate,
    rows: normalized,
    scalar,
    summary,
    metrics: compiled.metrics.map((m) => m.label),
    groupBy: compiled.groupBy.map((g) => g.label),
    limit: compiled.limit,
    // sql 与 params 只用于落库审计与调试；params 里可能含 scope 的 deptId/userId
    sql: compiled.sql,
    params: compiled.params,
  };
}
