// lib/services/notice.js — 公告服务（从 api/af/notice.js 抽出，行为逐字节保持不变）
//
// 调用方：api/af/notice.js（人工） + lib/ai-actions.js（AI 对话触发）
// 约定见 ./_actor.js
import { HttpError, opLog } from '../guard.js';
import { query } from '../db.js';
import { auditDetail, hasRole, isAdmin } from './_actor.js';
// C9 公告摘要（AI）。服务层引用 AI 的安全前提：ai-summary 内部**先查开关**，
//   关闭时立刻返回 null（不发请求）；且这里用 `.catch(() => null)` 兜底 →
//   公告发布**永不因 AI 失败而失败**。这是"AI 可关、业务照常"的具体落实。
import { SUMMARY_MIN_CHARS, summarizeNotice } from '../ai-summary.js';

const STAFF = ['admin', 'counselor', 'teacher', 'leader'];
const PAGE_MAX = 50;
const PUBLISHERS = ['teacher', 'counselor', 'admin'];

/**
 * 公告列表（学生只看全校 + 本院；staff 看全部）
 * @returns {Promise<{data:{list:object[], total:number, page:number, pageSize:number}, message:string}>}
 */
export async function listNotices(actor, { page = 1, pageSize = 10 } = {}) {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(PAGE_MAX, Math.max(1, Number(pageSize) || 10));

  const staff = hasRole(actor, STAFF);
  const where = ['n.status = 1'];
  const params = [];
  if (!staff) {
    // 学生: 全校公告 + 本院公告
    where.push('(n.dept_id IS NULL OR n.dept_id = ?)');
    params.push(actor.deptId || 0);
  }

  const [[{ total }]] = [await query(`SELECT COUNT(*) AS total FROM af_notice n WHERE ${where.join(' AND ')}`, params)];
  const rows = await query(
    `SELECT n.id, n.title, n.content, n.summary, n.pinned, n.created_at, n.dept_id,
            d.name AS dept_name, COALESCE(u.real_name, '系统管理员') AS publisher_name
       FROM af_notice n
       LEFT JOIN sys_department d ON d.id = n.dept_id
       LEFT JOIN sys_user u ON u.id = n.publisher_id
      WHERE ${where.join(' AND ')}
      ORDER BY n.pinned DESC, n.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, ps, (p - 1) * ps],
  );
  return { data: { list: rows, total: Number(total), page: p, pageSize: ps }, message: 'ok' };
}

/**
 * 发布公告
 * 院系定向口径（沿用原实现）：非超管**强制本院**；超管可指定 deptId 或发全校（null）
 */
export async function publishNotice(actor, body = {}) {
  if (!hasRole(actor, PUBLISHERS)) throw new HttpError(40301, '暂无权限执行该操作', 403);
  const title = String(body.title || '').trim().slice(0, 128);
  const content = String(body.content || '').trim().slice(0, 8000);
  if (!title || !content) throw new HttpError(45001, '标题和内容不能为空');

  const admin = isAdmin(actor);
  let targetDept = null;
  if (!admin) {
    if (!actor.deptId) throw new HttpError(40301, '未归属院系，不能发布公告', 403);
    targetDept = actor.deptId;
  } else if (body.deptId) {
    targetDept = Number(body.deptId);
  }
  const pinned = admin && Number(body.pinned) === 1 ? 1 : 0;

  // C9 公告摘要：开关关闭时 summarizeNotice 内部立刻返回 null（**不发请求、零开销**），
  //   失败也不抛错 → 公告照常发布，只是列表页没有摘要。AI 不参与"发不发"的决策。
  const summary = (await summarizeNotice({ title, content }).catch(() => null)) || '';

  const r = await query(
    'INSERT INTO af_notice (title, content, summary, publisher_id, dept_id, pinned) VALUES (?, ?, ?, ?, ?, ?)',
    [title, content, summary, actor.userId, targetDept, pinned],
  );
  await opLog(
    actor.userId,
    'notice.publish',
    `notice:${r.insertId}`,
    auditDetail(actor, summary ? `${title} [AI摘要]` : title),
    actor.ip,
  );
  return { data: { id: r.insertId, summary }, message: '公告已发布' };
}

/**
 * 给已有公告补摘要（C9；管理员在控制台/公告页手动触发）
 * @returns {Promise<{data:{id:number, summary:string}, message:string}>}
 */
export async function regenNoticeSummary(actor, id) {
  const n = await loadNoticeForWrite(actor, id);
  const rows = await query('SELECT title, content FROM af_notice WHERE id = ?', [n.id]);
  const content = String(rows[0]?.content || '').trim();
  // ★ 先区分"本就不需要摘要"（2026-10-10 体检）：
  //   summarizeNotice 返回 null 有四种原因，其中"正文太短"与"AI 不可用"完全不同 ——
  //   原实现一律提示"开关未开启或服务不可用"，会让管理员去查开关（其实只要把公告写长点）。
  if (content.length < SUMMARY_MIN_CHARS) {
    throw new HttpError(49401, `公告正文只有 ${content.length} 字，太短了不需要摘要（至少 ${SUMMARY_MIN_CHARS} 字）`, 400);
  }
  const summary = await summarizeNotice({ title: rows[0]?.title, content });
  if (!summary) throw new HttpError(49430, '未能生成摘要（AI 摘要开关未开启，或 AI 服务暂时不可用）', 503);
  await query('UPDATE af_notice SET summary = ? WHERE id = ?', [summary, n.id]);
  await opLog(actor.userId, 'notice.summary', `notice:${n.id}`, auditDetail(actor, summary), actor.ip);
  return { data: { id: n.id, summary }, message: '摘要已生成' };
}

/**
 * 切换置顶（仅超管）
 * @param {{on?:boolean}} [opts] 显式指定目标状态；不传则取反（保持原行为）
 *
 * ⚠ 校验顺序刻意保持与原实现一致：先"是不是自己的公告"，再"是不是管理员"。
 *   顺序反了会让非作者的辅导员收到"仅管理员可置顶"而不是"只能管理自己发布的公告"，
 *   错误提示指向错误的操作，属于越改越糟。
 */
export async function setNoticePinned(actor, id, { on } = {}) {
  const n = await loadNoticeForWrite(actor, id);
  if (!isAdmin(actor)) throw new HttpError(40301, '仅管理员可置顶公告', 403);
  const next = typeof on === 'boolean' ? (on ? 1 : 0) : n.pinned === 1 ? 0 : 1;
  await query('UPDATE af_notice SET pinned = ? WHERE id = ?', [next, n.id]);
  // 原实现对 pin 未留痕（只对 publish/revoke 留痕）；此处补上——写操作一律审计（铁律 #4）
  await opLog(actor.userId, 'notice.pin', `notice:${n.id}`, String(next), actor.ip);
  return { data: { id: n.id, pinned: next }, message: next === 1 ? '已置顶' : '已取消置顶' };
}

/** 撤回公告（作者本人或超管） */
export async function revokeNotice(actor, id) {
  const n = await loadNoticeForWrite(actor, id);
  await query('UPDATE af_notice SET status = 0 WHERE id = ?', [n.id]);
  await opLog(actor.userId, 'notice.revoke', `notice:${n.id}`, auditDetail(actor, ''), actor.ip);
  return { data: { id: n.id }, message: '公告已撤回' };
}

/** 取公告并校验写权限（作者本人或超管） */
async function loadNoticeForWrite(actor, id) {
  const nid = Number(id);
  const rows = await query('SELECT id, publisher_id, pinned FROM af_notice WHERE id = ?', [nid]);
  if (rows.length === 0) throw new HttpError(45004, '公告不存在');
  const n = rows[0];
  if (!isAdmin(actor) && n.publisher_id !== actor.userId) throw new HttpError(40301, '只能管理自己发布的公告', 403);
  return n;
}

/**
 * 公告动作分发（handler 薄壳用）
 * @param {object} body { action, ... }
 */
export async function handleNoticeAction(actor, body = {}) {
  const action = String(body.action || 'publish');
  if (action === 'publish') return publishNotice(actor, body);
  if (action === 'revoke') return revokeNotice(actor, body.id);
  if (action === 'pin') return setNoticePinned(actor, body.id);
  if (action === 'summary') return regenNoticeSummary(actor, body.id); // C9 补摘要
  throw new HttpError(45001, '不支持的操作');
}
