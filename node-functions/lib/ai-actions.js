// node-functions/lib/ai-actions.js — C5 管理员智能管理：动作白名单注册表 + 两阶段确认
//
// ★ 这是整个 AI 功能里**唯一能产生写操作**的地方，安全设计的四条底线：
//
//   1. **白名单**：模型只能输出注册表里存在的 action key；不在表内一律拒绝（49402）。
//      模型**永不生成 SQL、永不调用任意函数** —— 它只做"意图分类 + 参数抽取"（ADR-9）。
//   2. **范围必须显式**：批量写操作必须由模型明确给出"全部"或具体账号列表。
//      只给一个模糊描述（params 为空）时**拒绝执行**，返回引导文案 ——
//      这是防"一句话把全校禁了"的最后一道闸（实测模型对集合指令不可靠，见 AI-FEATURES §8）。
//   3. **两阶段确认**：写操作第一次调用只返回**影响清单 + 确认令牌**，第二次带令牌才真执行。
//      令牌用 JWT HS256 签名、5 分钟失效、绑定操作者 sub（别的管理员拿到也不能用）。
//   4. **落到服务层**：真正执行调 lib/services/*，与人工点按钮**同一份**权限校验与审计（铁律 #4，
//      审计 detail 带 `via:ai` 前缀）。服务层自己还会再校验一次目标权限（双重兜底）。
//
// 另外：目标解析（resolve）阶段就把"不能操作自己""不能动管理员主账号"这类护栏做掉，
// 让用户在**确认清单里**就看见哪些不会被处理，而不是执行到一半报错。
import jwt from 'jsonwebtoken';
import { HttpError } from './guard.js';
import { ROLE_LABEL } from './ai-identity.js';
import { jwtSecret } from './auth.js';
import { hasRole, isAdmin } from './services/_actor.js';
import { countUsers, findUsers, findUsersByNames, setUserStatus } from './services/users.js';
import { decideLeave, listLeaves } from './services/leave.js';
import { loadNoticeForWrite, listNotices, publishNotice, revokeNotice, setNoticePinned } from './services/notice.js';
import { getReviewRecord, handleReview, listReviewQueue } from './ai-review.js';

export const CONFIRM_TTL_SEC = 5 * 60; // 确认令牌 5 分钟有效
const ROLES_ALL = ['admin', 'counselor', 'teacher', 'leader'];

/** 从 actor 的角度能否触发该动作 */
const canTrigger = (actor, action) => (action.roles || []).some((r) => hasRole(actor, [r]));

/** 目标精简展示（确认清单里给人看的） */
const brief = (u) => `${u.real_name || u.username}（${u.username}）${u.dept_name ? ` · ${u.dept_name}` : ''}`;

/**
 * ★ 给目标补上 `label`：确认清单直接渲染 `label`，
 *   若解析结果只有 username/real_name，前端拿到的就是一堆 null ——
 *   而"能看清将被影响的是谁"正是二次确认存在的意义（2026-10-09 线上验收暴露）。
 */
const withLabel = (list) => (list || []).map((u) => ({ ...u, label: brief(u) }));

/** 把"学生姓名/账号"这类关键字统一成 findUsers 的筛选 */
const userFilters = (p = {}) => ({
  // 模型有时把姓名放在 names 数组里（而不是 keyword），这里统一收口
  keyword: p.keyword
    ? String(p.keyword).slice(0, 32)
    : Array.isArray(p.names) && p.names[0]
      ? String(p.names[0]).slice(0, 32)
      : '',
  role: p.role ? String(p.role).slice(0, 32) : '',
  status: p.status === 0 || p.status === '0' ? '0' : p.status === 1 || p.status === '1' ? '1' : '',
});

/**
 * ★ 账号名的「同一性」归一化 —— 只做字符串收窄，不做模糊匹配。
 *
 * 为什么需要（2026-10-20 实测）：用户会说「禁用教师账号teacher01」「王志远老师的账号」，
 * 模型会**原样**把这些片段塞进 `usernames`，于是 `findUsersByNames` 的精确 `IN` 必然落空，
 * 用户看到的就是一句「找不到」——而账号明明存在。
 * 这里把「角色前缀 / 后缀 / 标点 / 空格」剥掉，再补一个 ASCII 账号名候选，
 * **命中与否仍由 SQL 精确 IN 决定**（不引入 `LIKE`，因此不会误伤同名前缀的账号）。
 *
 * @param {string} raw
 * @returns {string[]} 候选（首个是原样，其余是收窄后的）
 */
const NAME_NOISE = /(的)?(账号|帐号|账户|用户|老师|同学|学生|教师|工号|学号|这条|那条|这个|那个|请假单|请假条|请假|假条|假单|销假|病假|事假|审批|申请|记录|单号|编号)/g;
export function nameVariants(raw) {
  const s = String(raw ?? '').trim().slice(0, 64);
  if (!s) return [];
  const out = new Set([s]);
  const cleaned = s.replace(NAME_NOISE, '').replace(/[\s,，、:：;；"'“”‘’()（）「」『』【】《》〈〉]/g, '').trim();
  // 纯数字不收：findUsersByNames 只比对 username / real_name，数字串只会白查一次
  if (cleaned.length >= 2 && !/^\d+$/.test(cleaned)) out.add(cleaned);
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_.-]{2,31}/g)) out.add(m[0]);
  return [...out].slice(0, 4);
}

/**
 * 为找不到的名字给出**范围内**的相近账号建议。
 * ★ 只用 actor 自己的数据范围去查（findUsers 内部已按 scope 过滤），
 *   所以不会因为"提示"而泄露范围外账号是否存在。
 */
async function suggestUsers(actor, raw) {
  const candidates = nameVariants(raw).sort((a, b) => b.length - a.length).slice(0, 2);
  for (const c of candidates) {
    const rows = await findUsers(actor, { keyword: c.slice(0, 32), limit: 5 });
    if (rows.length) return rows.slice(0, 3).map(brief).join('、');
  }
  return '';
}

/**
 * 解析用户目标集合（写操作与预览共用）
 * @param {{all?:boolean, usernames?:string[], role?:string, keyword?:string, status?:any}} p
 */
async function resolveUserTargets(actor, p = {}) {
  const warnings = [];
  const explicit = Array.isArray(p.usernames) ? p.usernames.map((s) => String(s).trim()).filter(Boolean) : [];

  // ---- 情况 A：模型明确列了账号名 → 按名字**精确 SQL 查**（不能拉一页再内存筛，见该函数注释）----
  if (explicit.length) {
    // 归一化：一个输入可能派生出多个候选（如「教师账号teacher01」→ teacher01）
    const names = [...new Set(explicit.flatMap(nameVariants))];
    const found = await findUsersByNames(actor, names);
    const hitNames = new Set(found.flatMap((u) => [String(u.username).toLowerCase(), String(u.real_name || '').toLowerCase()]));
    const missing = explicit.filter((n) => !nameVariants(n).some((v) => hitNames.has(v.toLowerCase())));
    if (missing.length) {
      // ★ 必须区分「账号不存在」与「存在但不在你的数据范围」——
      //   两种情况此前共用一句"（或不在你的数据范围内）"，用户无从判断该找谁。
      const scopeNote = hasRole(actor, ['admin']) ? '' : '（你的数据范围不是全校，只能操作本院账号）';
      warnings.push(`未找到账号${scopeNote}：${missing.join('、')}`);
      for (const n of missing.slice(0, 3)) {
        const near = await suggestUsers(actor, n);
        if (near) warnings.push(`你要找的是不是：${near}`);
      }
    }
    return { targets: withLabel(found), warnings };
  }

  // ---- 情况 A2：没给 usernames，但给了姓名/关键字（模型与规则层最常见的两种写法）----
  // ★ 原实现走到这里会直接抛「请说明要对哪些账号执行」——
  //   于是「禁用方欣雪」「把 teacher01 停用」这类**看起来再明确不过**的话被拒绝。
  //   现在按"≤5 个算明确目标、>5 个要求收窄"处理：既能用，又不会一句话批量误伤。
  //   ⚠ 只有真的带了姓名/关键字才走这条；完全没给范围时仍按原口径引导（防"一句话把全校禁了"）。
  const nameHints = [...(Array.isArray(p.names) ? p.names : []), p.keyword].filter(Boolean);
  if (!p.all && nameHints.length) {
    const cands = nameHints.flatMap(nameVariants).slice(0, 8);
    for (const c of [...new Set(cands)]) {
      const rows = await findUsers(actor, { ...userFilters({ keyword: c }), limit: 6 });
      if (!rows.length) continue;
      if (rows.length > 5) {
        throw new HttpError(
          49402,
          `关键字「${c}」匹配到 6 个以上账号，请给出具体账号名或加角色范围（例如"所有学生"）`,
        );
      }
      return {
        targets: withLabel(rows),
        warnings: [`按关键字「${c}」匹配到 ${rows.length} 个账号，请核对清单后确认`],
      };
    }
    const name = cands[0] || '';
    const near = name ? await suggestUsers(actor, name) : '';
    warnings.push(`未找到账号（或不在你的数据范围内）：${name}`);
    if (near) warnings.push(`你要找的是不是：${near}`);
    return { targets: [], warnings };
  }

  // ---- 情况 B：按筛选批量 → 必须显式 all:true ----
  if (!p.all) {
    throw new HttpError(
      49402,
      '请说明要对哪些账号执行：可以给出具体账号名（如"禁用 student01"），或明确说"全部"/"所有XX角色"',
    );
  }
  const filters = userFilters(p);
  if (!filters.keyword && !filters.role) {
    // "全部"但没有任何限定 = 全校所有账号 → 危险，要求至少给一个范围
    throw new HttpError(49402, '范围太大：请指明角色（如"所有学生"）或关键字，或直接给出账号名');
  }
  const targets = await findUsers(actor, { ...filters, limit: 200 });
  return { targets: withLabel(targets), warnings };
}

/** 过滤掉不可操作的目标（自己 / 管理员账号），并说明原因 */
function filterUserTargets(actor, targets, { forStatus }) {
  const skipped = [];
  const kept = [];
  // ★ 每条 skip 都要带机器可读的 `code`：调用方要据此区分
  //   「本来就是目标状态」（无需操作，不是错误）与「无权限/找不到」（真正的拒绝）。
  //   只靠中文 reason 做正则匹配太脆（改一个字就失效）。
  for (const u of targets) {
    if (Number(u.id) === Number(actor.userId)) {
      skipped.push({ id: u.id, label: brief(u), code: 'self', reason: '不能操作自己的账号' });
      continue;
    }
    if ((u.roles || []).includes('admin')) {
      skipped.push({ id: u.id, label: brief(u), code: 'admin', reason: '管理员账号受保护，需先移除其管理员角色' });
      continue;
    }
    if (forStatus !== undefined && Number(u.status) === Number(forStatus)) {
      skipped.push({
        id: u.id,
        label: brief(u),
        code: 'already',
        reason: forStatus === 0 ? '账号已是禁用状态' : '账号已是启用状态',
      });
      continue;
    }
    kept.push(u);
  }
  return { kept, skipped };
}

/**
 * 动作注册表 —— **唯一事实来源**
 * @property {string} key
 * @property {string} label 中文名（前端与提示词都用它）
 * @property {string[]} roles 允许触发的角色
 * @property {'read'|'write'} kind
 * @property {boolean} destructive 是否需要二次确认（kind=write 一律 true，保留字段便于将来放宽）
 * @property {string} desc 给模型看的一句话说明
 * @property {object} params 参数 schema（给模型看 + 服务端校验）
 */
export const ACTIONS = {
  // ============ 读：直接执行并返回表格 ============
  query_users: {
    label: '查询账号',
    roles: ['admin', 'counselor'],
    kind: 'read',
    desc: '查询账号列表或**只统计个数**。用户只关心数量时务必传 countOnly=true，否则会列出明细',
    params: {
      keyword: { type: 'string', desc: '账号名/姓名/学号/邮箱关键字' },
      role: { type: 'enum', values: ['student', 'teacher', 'counselor', 'leader', 'admin'], desc: '按角色筛选' },
      status: { type: 'enum', values: ['0', '1'], desc: '0=已禁用 1=正常，不填为全部' },
      countOnly: {
        type: 'enum',
        values: ['1'],
        desc: '**只要个数时传 "1"**（如"有多少个学生账号"），不要列明细',
      },
    },
    run: async (actor, p) => {
      const filters = userFilters(p);
      // ★ 只要个数 → 直接给总数，不拉明细。
      //   2026-10-10 用户原话「每次提问账号问题就是输出 50 个账号和死的一样」——
      //   根因之一是模型选了本动作却不传计数意图，于是必定返回 50 行。
      //   做法：动作支持 countOnly，提示词里也写明"只关心数量时用它"。
      if (String(p.countOnly) === '1') {
        // ★ 用 countUsers 而非 findUsers：后者是分页数组、没有 total，
        //   且超过 FIND_MAX 时长度会被截断，计数必然错。
        const n = await countUsers(actor, filters);
        // 用户可见文案里不该出现 `student` 这种英文角色码 —— 之前输出的是
        // 「共 404 个student 角色的账号。」，既中英混排又难读。
        // 角色中文名引用 lib/ai-identity.js 的 ROLE_LABEL（不另写一份映射，
        // 否则同一个人在 AI 身份块和这里会有两种叫法）。
        const roleLabel = filters.role ? ROLE_LABEL[filters.role] || filters.role : '';
        const statusLabel =
          String(filters.status) === '1' ? '状态为「正常」的' : String(filters.status) === '0' ? '状态为「已禁用」的' : '';
        const what = `${statusLabel}${roleLabel}账号`;
        return {
          rows: [{ [`${roleLabel || ''}账号数`]: n }],
          scalar: n,
          summary: `共 ${n} 个${what}。`,
        };
      }
      const rows = await findUsers(actor, { ...filters, limit: 50 });
      return {
        rows: rows.map((u) => ({
          账号: u.username,
          姓名: u.real_name,
          角色: (u.roles || []).join('/'),
          院系: u.dept_name || '-',
          状态: Number(u.status) === 1 ? '正常' : '已禁用',
        })),
        // ★★ 这个分支**绝不能返回 scalar**（2026-10-10 实测踩到）：
        //   `scalar` 的语义是"结果是一个单值，不是一张表"，前端据此**只答一句话、不渲染表格**。
        //   列表分支若也给 scalar（曾写 `rows.length < 50 ? rows.length : null`），
        //   用户说「查看所有禁用的账号」就会被渲染成一句「共找到 2 个账号」——
        //   **想看的清单表格被吞掉了**。只有当用户问的是"有多少"（走上面的 countOnly）
        //   才该给 scalar。
        summary:
          rows.length >= 50
            ? `账号较多，只列出前 50 条（共 ${rows.length}+ 条）。想看总数可以说"有多少个账号"。`
            : `共找到 ${rows.length} 个账号`,
      };
    },
  },

  query_leaves: {
    label: '查询请假单',
    roles: ['counselor', 'admin'],
    kind: 'read',
    desc: '查询请假单，可按状态筛选；"待审批"对应 status=1',
    params: {
      status: { type: 'enum', values: ['1', '2', '3', '4'], desc: '1=审批中 2=已批准 3=已驳回 4=已销假' },
      keyword: { type: 'string', desc: '学生姓名/学号关键字' },
      names: { type: 'array', desc: '学生姓名候选（可多个）' },
    },
    run: async (actor, p) => {
      // ★ 关键字下推到 SQL：原实现是"先取最新 100 条、再内存过滤"，
      //   当待审批超过 100 条时，点名更早的单子会查不到（2026-10-20 实测 113 条）。
      //   姓名候选（规则层抽出 / 模型给在 usernames 里）也在这里统一收口。
      const kw = String(p.keyword || (Array.isArray(p.names) ? p.names[0] : '') || (Array.isArray(p.usernames) ? p.usernames[0] : '') || '').trim();
      const r = await listLeaves(actor, {
        status: p.status ? String(p.status) : undefined,
        keyword: kw || undefined,
        limit: 200,
      });
      const list = r.data.list;
      const shown = list.slice(0, 50);
      return {
        rows: shown.map((x) => ({
          单号: x.id,
          学生: x.real_name || x.username,
          院系: x.dept_name || '-',
          类型: x.type,
          状态: x.status_text,
          事由: String(x.reason || '').slice(0, 30),
        })),
        summary: `共 ${list.length}${list.length >= 200 ? '+' : ''} 条请假单${kw ? `（按关键字「${kw}」过滤）` : ''}${p.status ? `，状态=${p.status}` : ''}，显示前 ${shown.length} 条`,
      };
    },
  },

  query_notices: {
    label: '查询公告',
    roles: ['teacher', 'counselor', 'admin'],
    kind: 'read',
    desc: '查询已发布的公告列表',
    params: {},
    run: async (actor) => {
      const r = await listNotices(actor, { page: 1, pageSize: 20 });
      return {
        rows: r.data.list.slice(0, 20).map((n) => ({
          编号: n.id,
          标题: n.title,
          范围: n.dept_name || '全校',
          发布人: n.publisher_name,
          置顶: Number(n.pinned) === 1 ? '是' : '',
        })),
        summary: `共 ${r.data.total} 条公告，显示前 ${Math.min(20, r.data.list.length)} 条`,
      };
    },
  },

  query_review_queue: {
    label: '查询待复核内容',
    roles: ['admin'],
    kind: 'read',
    desc: '查询论坛 AI 审核的待人工复核队列',
    params: {
      handled: { type: 'enum', values: ['0', '1', '2', 'all'], desc: '0=待复核 1=已确认违规 2=误判放行 all=全部' },
    },
    run: async (actor, p) => {
      const q = await listReviewQueue({ handled: p.handled ?? '0', page: 1, pageSize: 20 });
      return {
        rows: q.list.map((x) => ({
          编号: x.id,
          对象: x.biz === 'thread' ? '帖子' : '回复',
          作者: x.author_name || x.username || '-',
          判定: x.verdict,
          分类: x.categories || '-',
          置信度: Number(x.confidence ?? 0).toFixed(2),
          摘要: String(x.excerpt || x.target_title || '').slice(0, 40),
        })),
        summary: `共 ${q.total} 条记录（handled=${p.handled ?? '0'}）`,
      };
    },
  },

  // ============ 写：必须先预览 + 二次确认 ============
  disable_users: {
    label: '禁用账号',
    roles: ['admin', 'counselor'],
    kind: 'write',
    destructive: true,
    desc: '禁用账号（被禁用的账号无法登录、无法刷新令牌）',
    params: {
      usernames: { type: 'array', desc: '要禁用的账号名（或学生姓名）列表，如 ["student01"]' },
      role: { type: 'enum', values: ['student', 'teacher', 'counselor', 'leader', 'admin'], desc: '按角色批量筛选' },
      keyword: { type: 'string', desc: '账号/姓名/学号关键字' },
      all: { type: 'boolean', desc: '是否对该筛选范围内的【全部】账号执行，必须为 true 才允许批量' },
    },
    resolve: async (actor, p) => {
      const { targets, warnings } = await resolveUserTargets(actor, p);
      const { kept, skipped } = filterUserTargets(actor, targets, { forStatus: 0 });
      return { targets: kept, skipped, warnings };
    },
    run: async (actor, p, targets) => {
      const done = [];
      for (const t of targets) {
        await setUserStatus(actor, t.id, 0);
        done.push(brief(t));
      }
      return { message: `已禁用 ${done.length} 个账号`, affected: done };
    },
  },

  enable_users: {
    label: '启用账号',
    roles: ['admin', 'counselor'],
    kind: 'write',
    destructive: true,
    desc: '启用（恢复）被禁用的账号',
    params: {
      usernames: { type: 'array', desc: '要启用的账号名（或姓名）列表' },
      role: { type: 'enum', values: ['student', 'teacher', 'counselor', 'leader', 'admin'], desc: '按角色批量筛选' },
      keyword: { type: 'string', desc: '账号/姓名/学号关键字' },
      all: { type: 'boolean', desc: '是否对该筛选范围内的【全部】账号执行' },
    },
    resolve: async (actor, p) => {
      const { targets, warnings } = await resolveUserTargets(actor, { ...p, status: '0' });
      const { kept, skipped } = filterUserTargets(actor, targets, { forStatus: 1 });
      return { targets: kept, skipped, warnings };
    },
    run: async (actor, p, targets) => {
      const done = [];
      for (const t of targets) {
        await setUserStatus(actor, t.id, 1);
        done.push(brief(t));
      }
      return { message: `已启用 ${done.length} 个账号`, affected: done };
    },
  },

  approve_leaves: {
    label: '批准请假',
    roles: ['counselor', 'admin'],
    kind: 'write',
    destructive: true,
    desc: '批准（通过）指定请假申请',
    params: {
      leaveIds: { type: 'array', desc: '请假单号列表（数字）' },
      keyword: { type: 'string', desc: '学生姓名关键字，用于匹配待审批单据' },
      names: { type: 'array', desc: '学生姓名候选（可多个，如 ["方欣雪"]）' },
      all: { type: 'boolean', desc: '是否批准【全部】待审批单据，必须为 true 才允许批量' },
      opinion: { type: 'string', desc: '审批意见（可选）' },
    },
    resolve: async (actor, p) => {
      // ★★ 这里曾经写成 `const { kept } = await resolveLeaveTargets(...)`，
      //   而 resolveLeaveTargets 返回的是 `{ targets }` —— kept 恒为 undefined，
      //   于是 previewWriteAction 收到空目标，**任何"批准请假"都只会回一句
      //   「没有匹配到可操作的目标」，从上线起就没成功过一次**（2026-10-20 复现确认）。
      //   现在与 reject_leaves 一样直接透传，避免同一个返回值出现两种解构口径。
      return resolveLeaveTargets(actor, p);
    },
    run: async (actor, p, targets) => {
      const done = [];
      for (const t of targets) {
        await decideLeave(actor, { leaveId: t.id, approve: true, opinion: p.opinion || '同意' });
        done.push(`#${t.id} ${t.real_name || ''}`);
      }
      return { message: `已批准 ${done.length} 条请假申请`, affected: done };
    },
  },

  reject_leaves: {
    label: '驳回请假',
    roles: ['counselor', 'admin'],
    kind: 'write',
    destructive: true,
    desc: '驳回指定请假申请',
    params: {
      leaveIds: { type: 'array', desc: '请假单号列表（数字）' },
      keyword: { type: 'string', desc: '学生姓名关键字' },
      names: { type: 'array', desc: '学生姓名候选（可多个）' },
      all: { type: 'boolean', desc: '是否驳回【全部】待审批单据' },
      opinion: { type: 'string', desc: '驳回原因' },
    },
    resolve: async (actor, p) => resolveLeaveTargets(actor, p),
    run: async (actor, p, targets) => {
      const done = [];
      for (const t of targets) {
        await decideLeave(actor, { leaveId: t.id, approve: false, opinion: p.opinion || '不符合请假规定' });
        done.push(`#${t.id} ${t.real_name || ''}`);
      }
      return { message: `已驳回 ${done.length} 条请假申请`, affected: done };
    },
  },

  publish_notice: {
    label: '发布公告',
    roles: ['teacher', 'counselor', 'admin'],
    kind: 'write',
    destructive: true,
    desc: '发布一条公告（发布后全校/本院可见）',
    params: {
      title: { type: 'string', desc: '公告标题，必填' },
      content: { type: 'string', desc: '公告正文，必填' },
      pinned: { type: 'boolean', desc: '是否置顶（仅超管有效）' },
    },
    resolve: async (actor, p) => {
      const title = String(p.title || '').trim();
      const content = String(p.content || '').trim();
      if (!title || !content) throw new HttpError(49402, '发布公告需要同时给出标题和正文');
      const scopeLabel = isAdmin(actor) ? (p.pinned ? '全校 + 置顶' : '全校（未指定院系）') : '本院';
      return {
        targets: [{ id: 0, label: `《${title.slice(0, 30)}》` }],
        skipped: [],
        warnings: [`发布范围：${scopeLabel}`, '发布后学生即可在【公告中心】看到'],
        payload: { title, content, pinned: p.pinned },
      };
    },
    run: async (actor, p) => {
      const r = await publishNotice(actor, { title: p.title, content: p.content, pinned: p.pinned ? 1 : 0 });
      return { message: r.message, affected: [`公告 #${r.data.id}：《${String(p.title).slice(0, 30)}》`] };
    },
  },

  revoke_notice: {
    label: '撤回公告',
    roles: ['teacher', 'counselor', 'admin'],
    kind: 'write',
    destructive: true,
    desc: '撤回（下架）一条公告',
    params: { noticeId: { type: 'number', desc: '公告编号' } },
    resolve: async (actor, p) => {
      // 编号可能被规则层抽成 noticeId，也可能被模型塞进 leaveIds（通用数字槽）
      const id = Number(p.noticeId) || Number((Array.isArray(p.leaveIds) ? p.leaveIds[0] : 0)) || 0;
      if (!id) throw new HttpError(49402, '请给出要撤回的公告编号');
      // ★ 按 id 直接取 + 服务层权限校验；原实现是"拉最新 50 条再内存找"，
      //   公告一多，早先发的那条就永远撤不回（2026-10-20 同类缺陷一并修掉）。
      const hit = await loadNoticeForWrite(actor, id);
      return { targets: [{ id, label: `《${String(hit.title || '').slice(0, 30)}》` }], skipped: [], warnings: [] };
    },
    run: async (actor, p) => {
      const r = await revokeNotice(actor, p.noticeId);
      return { message: r.message, affected: [`公告 #${p.noticeId}`] };
    },
  },

  pin_notice: {
    label: '置顶/取消置顶公告',
    roles: ['admin'],
    kind: 'write',
    destructive: true,
    desc: '把公告置顶或取消置顶',
    params: {
      noticeId: { type: 'number', desc: '公告编号' },
      on: { type: 'boolean', desc: 'true=置顶 false=取消置顶' },
    },
    resolve: async (actor, p) => {
      const id = Number(p.noticeId) || Number((Array.isArray(p.leaveIds) ? p.leaveIds[0] : 0)) || 0;
      if (!id) throw new HttpError(49402, '请给出要操作的公告编号');
      // 同 revoke_notice：按 id 直接取，避免"只看得到最新 50 条"
      const hit = await loadNoticeForWrite(actor, id);
      return {
        targets: [{ id, label: `《${String(hit.title || '').slice(0, 30)}》` }],
        skipped: [],
        warnings: [`目标状态：${p.on ? '置顶' : '取消置顶'}（当前：${Number(hit.pinned) === 1 ? '已置顶' : '未置顶'}）`],
      };
    },
    run: async (actor, p) => {
      const r = await setNoticePinned(actor, p.noticeId, { on: p.on === true });
      return { message: r.message, affected: [`公告 #${p.noticeId}`] };
    },
  },

  confirm_violation: {
    label: '确认内容违规',
    roles: ['admin'],
    kind: 'write',
    destructive: true,
    desc: '把 AI 审核记录确认为违规并处置（内容下架，可选禁言作者）',
    params: {
      reviewId: { type: 'number', desc: '审核记录编号（来自待复核队列）' },
      penalty: { type: 'boolean', desc: '是否同时对作者禁言' },
    },
    resolve: async (actor, p) => {
      const id = Number(p.reviewId) || Number((Array.isArray(p.leaveIds) ? p.leaveIds[0] : 0)) || 0;
      if (!id) throw new HttpError(49402, '请给出要处置的审核记录编号');
      // ★ 按 id 直接取（原实现只扫最新 50 条，较早的记录永远处置不了）
      const hit = await getReviewRecord(id);
      if (!hit) throw new HttpError(49431, '审核记录不存在');
      return {
        targets: [{ id, label: `#${id} ${hit.verdict || ''} · ${String(hit.excerpt || '').slice(0, 30)}` }],
        skipped: [],
        warnings: [
          `作者：${hit.author_name || hit.username || '-'}`,
          p.penalty ? '将对作者执行禁言' : '不禁言作者',
          '内容将被下架（软删）',
        ],
      };
    },
    run: async (actor, p) => {
      const r = await handleReview(actor, { id: p.reviewId, action: 'confirm_violation', penalty: Boolean(p.penalty) });
      return { message: r.message, affected: [`审核记录 #${p.reviewId}`] };
    },
  },
};

/** 解析请假单目标集合 */
async function resolveLeaveTargets(actor, p = {}) {
  const warnings = [];
  const ids = Array.isArray(p.leaveIds) ? p.leaveIds.map(Number).filter(Boolean).slice(0, 200) : [];

  // ★ 姓名可能来自三个地方（keyword / names / usernames）——模型和规则层写法不统一。
  //   统一"去噪 + 去重"后再查：`方欣雪的请假` → `方欣雪`，`教师账号xxx` 也顺带归一化。
  const nameCands = [
    ...new Set(
      [...(Array.isArray(p.names) ? p.names : []), p.keyword, ...(Array.isArray(p.usernames) ? p.usernames : [])]
        .filter(Boolean)
        .flatMap(nameVariants)
        .map((s) => String(s).trim().slice(0, 32))
        .filter(Boolean),
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);

  if (!ids.length && !nameCands.length && !p.all) {
    throw new HttpError(49402, '请说明要处理哪一条：给出单号、学生姓名，或明确说"全部待审批"');
  }

  // ★★ 过滤必须下推到 SQL，不能"先取最新 100 条再内存筛"。
  //   线上实测（2026-10-20）：待审批共 113 条，而 listLeaves 的 LIMIT 100 把
  //   第 101 条及其后的单子彻底挡在 AI 视野之外 —— 点名某个学生也照样"找不到"。
  const limit = p.all ? 200 : 100;
  let pending = [];
  let usedName = '';

  if (ids.length) {
    pending = (await listLeaves(actor, { status: '1', ids, limit })).data.list;
    const got = new Set(pending.map((x) => Number(x.id)));
    const missing = ids.filter((id) => !got.has(id));
    if (missing.length) warnings.push(`以下单号不在"审批中"状态或不在你的范围内：#${missing.join('、#')}`);
  } else if (nameCands.length) {
    // 逐个候选试（长候选优先），命中即停：`方欣雪` 命中后不再用更短的候选扩大范围
    for (const c of nameCands) {
      const r = await listLeaves(actor, { status: '1', keyword: c, limit });
      if (r.data.list.length) {
        pending = r.data.list;
        usedName = c;
        break;
      }
    }
    if (!pending.length) {
      const near = await suggestUsers(actor, nameCands[0]);
      throw new HttpError(
        49402,
        `没有找到「${nameCands[0]}」名下"审批中"的请假单${near ? `。你要找的是不是：${near}` : '（可能已审批完，或不在你的数据范围）'}`,
      );
    }
    if (usedName && usedName !== nameCands[0]) warnings.push(`按「${usedName}」匹配到请假单`);
  } else {
    pending = (await listLeaves(actor, { status: '1', limit })).data.list;
  }

  // ★ 姓名可能一次命中太多（例如只说"张"）→ 不静默批量，要求收窄。
  //   这是"能听懂"和"别误伤"之间的分界：≤10 条直接进确认清单，>10 条先反问。
  if (!p.all && !ids.length && pending.length > 10) {
    const sample = pending
      .slice(0, 5)
      .map((x) => `#${x.id} ${x.real_name || x.username}`)
      .join('、');
    throw new HttpError(
      49402,
      `「${usedName || nameCands[0]}」匹配到 ${pending.length} 条待审批请假，范围太大。请给出单号或更完整的姓名，例如：${sample}`,
    );
  }
  if (pending.length >= limit) {
    warnings.push(`符合条件的有 ${limit} 条以上，本次只处理最新的 ${limit} 条；要处理更多请分批发或指定姓名/单号`);
  }

  if (!pending.length && !warnings.length) throw new HttpError(49402, '没有匹配到"审批中"的请假单');
  return {
    targets: pending.map((x) => ({ id: x.id, real_name: x.real_name, label: `#${x.id} ${x.real_name || x.username} · ${x.type} · ${x.status_text}` })),
    skipped: [],
    warnings,
  };
}

/** 供 /api/ai/status、提示词与管理页使用的能力目录 */
export function actionCatalog(actor) {
  return Object.entries(ACTIONS)
    .filter(([, a]) => canTrigger(actor, a))
    .map(([key, a]) => ({ key, label: a.label, kind: a.kind, destructive: Boolean(a.destructive), roles: a.roles, desc: a.desc }));
}

/** 组装给模型的「可用动作说明」（只列出该角色能用的，减少幻觉） */
export function actionPromptFor(actor) {
  const list = actionCatalog(actor);
  if (!list.length) return '（当前角色没有任何可执行的系统操作，只能回答知识类问题）';
  return list
    .map((a) => {
      const def = ACTIONS[a.key];
      const params = Object.entries(def.params)
        .map(([k, v]) => `    - ${k}: ${v.desc}${v.values ? `（可选值：${v.values.join('/')}）` : ''}`)
        .join('\n');
      return `- ${a.key}【${a.label}】${a.kind === 'write' ? '（写操作，需用户确认）' : '（只读）'}\n    ${a.desc}${params ? `\n${params}` : ''}`;
    })
    .join('\n');
}

// ---------- 两阶段确认令牌 ----------

/**
 * 签发确认令牌（5 分钟、绑定操作者）
 * @param {{userId:number, action:string, params:object, targetIds:number[]}} o
 */
export function signConfirmToken({ userId, action, params, targetIds }) {
  return jwt.sign(
    { sub: String(userId), act: action, prm: params || {}, tgt: targetIds || [] },
    jwtSecret(),
    { expiresIn: CONFIRM_TTL_SEC, algorithm: 'HS256', audience: 'ai-confirm' },
  );
}

/**
 * 校验确认令牌
 * @returns {{userId:number, action:string, params:object, targetIds:number[]}}
 */
export function verifyConfirmToken(token, actor) {
  let payload;
  try {
    payload = jwt.verify(String(token || ''), jwtSecret(), { algorithms: ['HS256'], audience: 'ai-confirm' });
  } catch {
    throw new HttpError(49404, '确认令牌无效或已过期（有效期 5 分钟），请重新发起');
  }
  if (String(payload.sub) !== String(actor.userId)) {
    throw new HttpError(49404, '确认令牌不属于当前登录用户，请重新发起');
  }
  const def = ACTIONS[payload.act];
  if (!def || def.kind !== 'write') throw new HttpError(49403, '该操作不在允许的白名单内', 403);
  if (!canTrigger(actor, def)) throw new HttpError(49403, `你的角色无权执行「${def.label}」`, 403);
  return { userId: Number(payload.sub), action: payload.act, params: payload.prm || {}, targetIds: payload.tgt || [] };
}

/**
 * 执行一次"预览"（写操作的第一步）
 * @returns {Promise<{action:string, label:string, preview:object, confirmToken:string}>}
 */
export async function previewWriteAction(actor, key, params = {}) {
  const def = ACTIONS[key];
  if (!def) throw new HttpError(49402, '无法识别的操作');
  if (!canTrigger(actor, def)) throw new HttpError(49403, `你的角色无权执行「${def.label}」`, 403);
  if (def.kind !== 'write') throw new HttpError(49402, '该操作为只读，无需确认');

  const r = await def.resolve(actor, params);
  // ★ 结构自检：resolve 必须回 `{ targets: [...] }`。
  //   历史上 approve_leaves 的 resolve 解构了不存在的 `kept`，于是 targets 恒为空，
  //   用户看到的是「没有匹配到可操作的目标」——一个**看起来像"数据不存在"、
  //   实际是代码 bug** 的假象，线上很难定位（2026-10-20 修复）。
  //   缺少字段属于内部实现错误，必须明确报出来，不能再伪装成"没找到"。
  if (!r || !Array.isArray(r.targets)) {
    throw new HttpError(49500, `内部错误：操作「${def.label}」的目标解析结果不合法（缺少 targets 列表），请联系管理员`, 500);
  }
  const targets = r.targets;
  const skipped = r.skipped || [];
  if (!targets.length) {
    // ★★ 「本来就是目标状态」不是错误，而是"无需重复操作"（2026-10-10 用户反馈）。
    //
    //   用户原话：「让 AI 禁用某个账号，如果已经禁用，会直接回复我找不到；
    //   理论上应该回复'已经禁用'」—— 判断正确。
    //   此前无论什么原因都抛同一条消息，且**只拼了 warnings、把 skipped.reason 丢掉了**，
    //   于是最有信息量的那句「账号已是禁用状态」根本没到用户眼前，
    //   他看到的就是一句干巴巴的"没有匹配到可操作的目标"（≈ 找不到）。
    //
    //   现在分两种情况：
    //     · 全部是「已是目标状态」→ 返回 noop 信息性结果（按普通回答展示，不标成错误）
    //     · 其它（自己/管理员/找不到/越范围）→ 抛错，但**把每条原因都带上**
    const benignOnly = skipped.length > 0 && skipped.every((s) => s.code === 'already');
    if (benignOnly) {
      return {
        action: key,
        label: def.label,
        noop: `${skipped.map((s) => `${s.label}：${s.reason}`).join('；')}，无需重复操作。`,
        noopSkipped: skipped.slice(0, 20),
      };
    }
    const why = [...skipped.map((s) => `${s.label}：${s.reason}`), ...(r.warnings || [])];
    throw new HttpError(
      49402,
      why.length ? `没有匹配到可操作的目标 —— ${why.join('；')}` : '没有匹配到可操作的目标',
    );
  }
  return {
    action: key,
    label: def.label,
    preview: {
      count: targets.length,
      items: targets.slice(0, 50).map((t) => ({ id: t.id, label: t.label })),
      truncated: targets.length > 50,
      skipped: skipped.slice(0, 20),
      warnings: r.warnings || [],
      payload: r.payload || null,
    },
    confirmToken: signConfirmToken({
      userId: actor.userId,
      action: key,
      // payload 类动作（发公告）没有实体 id，把参数一起签进令牌里
      params: r.payload ? { ...params, ...r.payload } : params,
      targetIds: targets.map((t) => t.id),
    }),
  };
}

/**
 * 执行已确认的写操作（第二步）。目标**在执行前重新解析**，不直接信令牌里的 id 列表 ——
 * 因为从预览到确认之间数据可能已变（有人抢先禁用了该账号），
 * 重新解析能让"跳过原因"如实反映当下状态。
 */
export async function executeConfirmedAction(actor, token) {
  const { action, params, targetIds } = verifyConfirmToken(token, actor);
  const def = ACTIONS[action];
  const r = await def.resolve(actor, params);
  const idSet = new Set(targetIds.map(Number));
  let targets = (r.targets || []).filter((t) => idSet.has(Number(t.id)));
  const skipped = [...(r.skipped || [])];

  if (!targets.length) {
    // 全部目标在确认期间变成不可操作 → 如实说明，不要报"成功 0 条"让人疑惑
    const why = skipped.length ? skipped.map((s) => `${s.label}：${s.reason}`).join('；') : '目标已不存在或状态已变化';
    throw new HttpError(49405, `待确认的操作已失效：${why}`);
  }
  // 重新过滤一次（预览后可能有人把目标改成了管理员/自己）
  if (action === 'disable_users' || action === 'enable_users') {
    const wantStatus = action === 'disable_users' ? 0 : 1;
    const again = filterUserTargets(actor, targets, { forStatus: wantStatus });
    targets = again.kept;
    skipped.push(...again.skipped);
    if (!targets.length) throw new HttpError(49405, `待确认的操作已失效：${again.skipped.map((s) => s.reason).join('；')}`);
  }

  const out = await def.run(actor, params, targets);
  return {
    action,
    label: def.label,
    result: { message: out.message, affected: out.affected || [], skipped: skipped.slice(0, 20) },
  };
}

/** 执行只读动作 */
export async function runReadAction(actor, key, params = {}) {
  const def = ACTIONS[key];
  if (!def) throw new HttpError(49402, '无法识别的操作');
  if (!canTrigger(actor, def)) throw new HttpError(49403, `你的角色无权执行「${def.label}」`, 403);
  if (def.kind !== 'read') throw new HttpError(49402, '该操作需要二次确认');
  const out = await def.run(actor, params, []);
  return { action: key, label: def.label, kind: 'read', ...out };
}

export { canTrigger, ROLES_ALL };
