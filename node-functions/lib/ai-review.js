// node-functions/lib/ai-review.js — C2 论坛 AI 审核员
//
// 定位（docs/AI-FEATURES.md §5.2）：发帖/回复**同步判定**，超时**放行并标记待复核**。
//   · 开关 `ai.forum_review.enabled`（**默认关**）—— 关掉时零额外开销（连 prompt 都不拼）
//   · `ai.forum_review.block_on_violation=1` 时，判定 violation 直接拒绝发帖
//   · `ai.forum_review.timeout_ms`（默认 3000）为**硬上限**：宁可放行后人工复核，也不能卡住发帖
//   · 铁律 #36：纯文本判定，**不读图片、不传任何多模态字段**
//
// 三个函数的分工：
//   reviewContent()   纯判定（不落库）
//   buildReviewHooks() 组装给 forum service 的 onBeforeInsert 钩子 + 结果暂存器
//   recordReview()     落 ai_review_log（需要帖子的 biz_id，所以必须由 handler 在插入后调用）
import { aiConfigured, aiJson, logAiUsage } from './ai.js';
import { getBool, getInt } from './ai-config.js';
import { query } from './db.js';
import { HttpError, opLog } from './guard.js';
import { alert } from './alert.js';

/** 违规分类（模型只能从这里选，避免自由发挥导致统计口径发散） */
export const REVIEW_CATEGORIES = ['广告', '辱骂', '涉政', '色情', '隐私泄露', '灌水', '违法', '其他'];

const VERDICTS = ['ok', 'suspect', 'violation'];

/** 判定词表的中文名 —— 词表归服务端，界面只渲染（铁律 #62：内部代号不上界面） */
export const VERDICT_LABEL = { ok: '正常', suspect: '可疑', violation: '违规' };

const SYSTEM = [
  '你是「智汇校园」校园论坛的内容审核员，负责判断用户发帖/回复是否违规。',
  '',
  `【违规分类】只能从以下列表中选择：${REVIEW_CATEGORIES.join('、')}`,
  '',
  '【判定口径】',
  '- ok：正常的校园交流、求助、二手交易、吐槽（不含人身攻击）都算正常。',
  '- suspect：擦边、含糊、疑似但不确定（例如疑似广告但可能是正常转让、情绪激烈但未辱骂）。',
  '- violation：明确违规（招生代写/代考、刷单兼职诈骗、辱骂或人身攻击、色情、政治敏感、',
  '  泄露他人隐私如手机号身份证号、无意义的灌水刷屏、明显违法内容）。',
  '',
  '【重要】',
  '1. 只输出 JSON，不要任何解释文字。',
  '2. 宁松勿紧：不确定就判 suspect，不要为了"安全"把正常内容判成 violation。',
  '3. 二手交易帖（含物品、价格、联系方式）属于正常内容，不是广告。',
].join('\n');

const SCHEMA_HINT = `{"verdict":"ok|suspect|violation","categories":["..."],"confidence":0.0,"reason":"一句话理由（20字内）"}`;

/** 规范化模型输出：非法 verdict 一律降级为 suspect（宁松勿紧，但不能凭空放行） */
export function normalizeVerdict(obj) {
  const v = String(obj?.verdict || '').toLowerCase().trim();
  const verdict = VERDICTS.includes(v) ? v : 'suspect';
  const cats = Array.isArray(obj?.categories)
    ? obj.categories.map((c) => String(c).trim()).filter((c) => REVIEW_CATEGORIES.includes(c)).slice(0, 4)
    : [];
  let conf = Number(obj?.confidence);
  if (!Number.isFinite(conf)) conf = 0;
  conf = Math.min(1, Math.max(0, conf));
  return { verdict, categories: cats, confidence: conf, reason: String(obj?.reason || '').slice(0, 200) };
}

/**
 * 内容审核判定
 * @returns {Promise<{verdict:string, categories:string[], confidence:number, reason:string, degraded?:boolean}|null>}
 *          `null` = 审核功能未开启/未配置（调用方应完全跳过，不落库）
 */
export async function reviewContent({ title = '', content = '', boardName = '', kind = 'thread' } = {}, { userId = 0 } = {}) {
  if (!(await getBool('ai.forum_review.enabled', false))) return null;
  if (!aiConfigured()) return null;
  if (!String(content).trim() && !String(title).trim()) return null;

  const timeoutMs = Math.max(500, await getInt('ai.forum_review.timeout_ms', 3000));
  const user = [
    `内容类型：${kind === 'reply' ? '回复' : '主题帖'}`,
    boardName ? `所在板块：${boardName}` : '',
    title ? `标题：${String(title).slice(0, 128)}` : '',
    `正文：${String(content).slice(0, 1500)}`,
    '',
    `请严格按此 JSON 结构输出：${SCHEMA_HINT}`,
  ]
    .filter(Boolean)
    .join('\n');

  const t0 = Date.now();
  // ★ 硬上限：aiJson 内部解析失败会重试一次（可能 2×timeoutMs），这里再套一层竞速，
  //   保证"发帖接口被审核拖住的时长"绝不超过 timeout_ms —— 宁可放行待复核，不能卡住发帖。
  let timedOut = false;
  // ★ 保存 timerId 并在竞速结束后清理（2026-10-10 体检）：AI 先返回时若不清，
  //   每次发帖/回复都会泄漏一个最长 timeout_ms 的挂起定时器。
  let timerId;
  const timer = new Promise((resolve) => {
    timerId = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, timeoutMs);
  });
  let raw;
  try {
    raw = await Promise.race([
      aiJson({ system: SYSTEM, user, maxTokens: 200, temperature: 0, timeoutMs, totalBudgetMs: timeoutMs }).catch(() => null),
      timer,
    ]);
  } finally {
    clearTimeout(timerId);
  }

  if (!raw) {
    await logAiUsage({ userId, kind: 'review', ok: 0, costMs: Date.now() - t0 });
    return {
      verdict: 'suspect',
      categories: [],
      confidence: 0,
      reason: timedOut ? `AI 审核未在 ${timeoutMs}ms 内返回，已放行待人工复核` : 'AI 审核调用失败，已放行待人工复核',
      degraded: true,
    };
  }

  await logAiUsage({
    userId,
    kind: 'review',
    promptTokens: raw._usage?.prompt_tokens ?? 0,
    completionTokens: raw._usage?.completion_tokens ?? 0,
    ok: 1,
    costMs: Date.now() - t0,
  });
  return { ...normalizeVerdict(raw), degraded: false };
}

/** 内容摘要（人工复核队列里显示这个，而不是整篇正文） */
export function excerptOf(title, content, max = 120) {
  const s = `${String(title || '').trim()} ${String(content || '').trim()}`.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 组装审核钩子（给 lib/services/forum.js 的 onBeforeInsert 用）
 *
 * 返回 `{ hooks, store }`：`store` 由 handler 在入库后交给 `recordReview()` 落库。
 * 这样设计的原因：`ai_review_log.biz_id` 必须是真实帖子 id，而钩子执行时**还没有 id**。
 *
 * @returns {Promise<{hooks:{onBeforeInsert?:Function}, store:{result:object|null, blocked:boolean, excerpt:string}}>}
 */
export async function buildReviewHooks({ kind = 'thread', title = '', content = '' } = {}) {
  const store = { result: null, blocked: false, excerpt: excerptOf(title, content) };
  const enabled = await getBool('ai.forum_review.enabled', false);
  if (!enabled || !aiConfigured()) return { hooks: {}, store };

  const blockOnViolation = await getBool('ai.forum_review.block_on_violation', true);

  return {
    store,
    hooks: {
      onBeforeInsert: async (payload) => {
        const result = await reviewContent(
          { title: payload.title, content: payload.content, boardName: payload.board?.name, kind },
          { userId: payload.userId },
        );
        if (!result) return null;
        store.result = result;
        store.excerpt = excerptOf(payload.title, payload.content);

        if (result.verdict === 'violation' && blockOnViolation) {
          store.blocked = true;
          const cats = result.categories.length ? result.categories.join('、') : '违规';
          return { block: true, message: `内容未通过 AI 审核（${cats}）：${result.reason || '请修改后重试'}` };
        }
        // violation 但管理员选择了"不拦截" → 也标为待复核，避免直接混进正常列表
        return { reviewStatus: result.verdict === 'ok' ? 0 : 1 };
      },
    },
  };
}

/**
 * 落审核留痕（handler 在 service 返回后调用；`store.result` 为空则完全跳过）
 * @param {{store:object, biz:'thread'|'reply', bizId:number|null, authorId:number}} p
 */
export async function recordReview({ store, biz, bizId, authorId }) {
  if (!store?.result) return;
  const r = store.result;
  try {
    await query(
      `INSERT INTO ai_review_log (biz, biz_id, author_id, verdict, categories, confidence, reason, excerpt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        biz,
        Number(bizId) || 0,
        Number(authorId) || 0,
        store.blocked ? 'violation' : r.degraded ? 'degraded' : r.verdict,
        (r.categories || []).join(','),
        Number.isFinite(r.confidence) ? r.confidence : null,
        String(r.reason || '').slice(0, 512),
        String(store.excerpt || '').slice(0, 255),
      ],
    );
  } catch (e) {
    // 留痕失败不能影响发帖结果
    console.error('[ai-review-log-fail]', e?.message);
  }
}

/**
 * C2 → C3 联动：内容被判违规时邮件告警管理员
 *
 * ⚠ **这里必须 await，不能 fire-and-forget**：Serverless/边缘运行时**不保证**响应返回后
 *   后台 Promise 还会执行完（isolate 可能立刻被冻结）。所以宁可在"已判定违规"这条
 *   罕见路径上多花一次邮件往返的时间，也不要出现"日志说该告警但邮件从没发出"。
 *   邮件失败不会抛异常（alertAdmins 内部吞掉），且带 30 分钟去重，不会成为性能负担。
 */
export async function alertViolation({ actor, store, biz, bizId, blocked = false }) {
  const r = store?.result;
  if (!r || r.verdict !== 'violation') return;
  const kind = biz === 'reply' ? '回复' : '帖子';
  const cats = (r.categories || []).join('、') || '未分类';
  await alert.contentViolation({
    title: `论坛${kind}被 AI 判定违规（${cats}）${blocked ? '，已拦截' : '，已入库待复核'}`,
    detail: [
      `处置结果：${blocked ? '已拦截，未入库' : `已入库（${kind} id=${bizId ?? '-'}），已标记待人工复核`}`,
      `违规分类：${cats}`,
      `置信度：${Number(r.confidence || 0).toFixed(2)}`,
      `判定理由：${r.reason || '-'}`,
      `内容摘要：${store.excerpt || '-'}`,
      `作者：${actor?.userId ?? '-'}（user id）`,
      r.degraded ? '注意：本次为 AI 降级判定（超时或失败），结论仅供参考。' : '',
      '',
      '请在【AI 管理控制台 → 审核队列】中确认违规或标记误判。',
    ]
      .filter(Boolean)
      .join('\n'),
    dedupeKey: `violation:${biz}:${bizId ?? 'blocked'}`,
  });
}

/** 待人工复核队列 / 审核日志 */export async function listReviewQueue({ handled = 0, page = 1, pageSize = 20 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(50, Math.max(1, Number(pageSize) || 20));
  const where = [];
  const params = [];
  if (String(handled) !== 'all') {
    where.push('l.handled = ?');
    params.push(Number(handled) || 0);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM ai_review_log l ${whereSql}`, params);
  const rows = await query(
    `SELECT l.*, u.real_name AS author_name, u.username,
            COALESCE(t.title, r.content) AS target_title,
            t.status AS thread_status
       FROM ai_review_log l
       LEFT JOIN sys_user u ON u.id = l.author_id
       LEFT JOIN forum_thread t ON l.biz = 'thread' AND t.id = l.biz_id
       LEFT JOIN forum_reply r ON l.biz = 'reply' AND r.id = l.biz_id
       ${whereSql}
      ORDER BY l.id DESC
      LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps],
  );
  // 每行补中文判定名：界面直接渲染，避免把 ok/suspect/violation 摆给用户看
  const list = rows.map((r) => ({ ...r, verdictLabel: VERDICT_LABEL[r.verdict] || '其他判定' }));
  return { list, total: Number(total), page: p, pageSize: ps };
}

/**
 * 处置一条审核记录（管理员复核）
 * @param {'confirm_violation'|'false_positive'} action
 */
export async function handleReview(actor, { id, action, penalty = false }) {
  const rid = Number(id);
  const rows = await query('SELECT * FROM ai_review_log WHERE id = ?', [rid]);
  if (rows.length === 0) throw new HttpError(49431, '审核记录不存在');
  const rec = rows[0];

  const confirm = action === 'confirm_violation';
  const nextHandled = confirm ? 1 : 2;
  await query('UPDATE ai_review_log SET handled = ?, handled_by = ?, handled_at = NOW() WHERE id = ?', [
    nextHandled,
    actor.userId,
    rid,
  ]);

  // 确认违规 → 内容按违规处理（帖子软删 / 回复软删；review_status=2）
  if (confirm) {
    if (rec.biz === 'thread') {
      await query('UPDATE forum_thread SET status = 0, review_status = 2 WHERE id = ?', [rec.biz_id]);
    } else {
      // ★ 回复软删必须**同步回退帖子的 reply_count**（2026-10-10 体检发现）：
      //   发帖/回复时 forum.js 会把 reply_count +1，隐藏回复却不减回去，
      //   列表页显示的回复数就包含了看不见的违规回复 —— 数字与列表对不上。
      //   ★ 必须幂等：管理员可能对同一条重复点"确认违规"（或先确认再复核），
      //     若每次都减，计数会被扣到 0 以下。所以只在"确实由可见变为隐藏"时才减。
      const [rp] = await query('SELECT thread_id AS threadId, status FROM forum_reply WHERE id = ?', [rec.biz_id]);
      if (rp && Number(rp.status) === 1) {
        await query('UPDATE forum_reply SET status = 0, review_status = 2 WHERE id = ?', [rec.biz_id]);
        await query('UPDATE forum_thread SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = ?', [rp.threadId]);
      } else if (rp) {
        // 已是隐藏状态：只更新复核标记，不重复扣数
        await query('UPDATE forum_reply SET review_status = 2 WHERE id = ?', [rec.biz_id]);
      }
    }
  } else {
    // 误判放行 → 标记为正常，避免列表里一直挂着"待复核"角标
    if (rec.biz === 'thread') await query('UPDATE forum_thread SET review_status = 0 WHERE id = ?', [rec.biz_id]);
    else await query('UPDATE forum_reply SET review_status = 0 WHERE id = ?', [rec.biz_id]);
  }

  // 可选惩罚：禁言（仅在确认违规且显式要求时）
  let banned = false;
  if (confirm && penalty && rec.author_id && rec.author_id !== actor.userId) {
    await query(
      `INSERT INTO forum_ban (user_id, reason, banned_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), banned_by = VALUES(banned_by), banned_at = NOW()`,
      [rec.author_id, `内容违规（AI 审核确认）：${String(rec.reason || '').slice(0, 80)}`, actor.userId],
    );
    banned = true;
  }

  await opLog(
    actor.userId,
    confirm ? 'ai.review.confirm' : 'ai.review.falsePositive',
    `${rec.biz}:${rec.biz_id}`,
    `handledBy=ai${banned ? ' banned=1' : ''}`,
    actor.ip,
  );

  return { data: { id: rid, handled: nextHandled, banned }, message: confirm ? '已确认违规并处置' : '已标记为误判，内容放行' };
}
