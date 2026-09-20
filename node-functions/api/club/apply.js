// /api/club/apply — 社团申请（学生提交，教务处=teacher/admin 审批）
// GET  学生: 自己的申请; teacher/admin: 全部（?status=0 待审）
// POST { action: 'create' | 'review', ... }
//   create (student): { name, location, content, outline, activityTime }
//   review (teacher/admin): { id, pass: true|false, opinion }
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const url = new URL(context.request.url);
    const isEdu = roles.some((r) => ['admin', 'teacher'].includes(r));

    const where = [];
    const params = [];
    if (isEdu) {
      const status = url.searchParams.get('status');
      if (status !== null && ['0', '1', '2'].includes(status)) {
        where.push('a.status = ?');
        params.push(Number(status));
      }
      const kw = String(url.searchParams.get('keyword') || '').trim();
      if (kw) {
        where.push('(a.name LIKE ? OR u.real_name LIKE ?)');
        params.push(`%${kw}%`, `%${kw}%`);
      }
    } else {
      where.push('a.proposer_id = ?');
      params.push(userId);
    }
    const rows = await query(
      `SELECT a.id, a.name, a.location, a.content, a.outline, a.activity_time AS activityTime,
              a.status, a.review_opinion AS reviewOpinion, a.reviewed_at AS reviewedAt, a.created_at AS createdAt,
              u.real_name AS proposerName, u.username, u.user_no AS userNo
         FROM club_application a
         JOIN sys_user u ON u.id = a.proposer_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY a.id DESC
        LIMIT 100`,
      params,
    );
    return ok({ list: rows, canReview: isEdu });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || '');

    if (action === 'create') {
      const name = String(body.name || '').trim().slice(0, 64);
      const location = String(body.location || '').trim().slice(0, 128);
      const content = String(body.content || '').trim().slice(0, 512);
      const outline = String(body.outline || '').trim().slice(0, 4096);
      const activityTime = String(body.activityTime || '').trim().slice(0, 128);
      if (!name) return fail(48001, '请填写社团名称');
      if (!location) return fail(48001, '请填写开课位置');
      if (!content) return fail(48001, '请填写内容简介');
      if (outline.length < 10) return fail(48001, '请填写活动大纲（至少 10 字）');
      if (!activityTime) return fail(48001, '请填写活动时间');

      const dup = await query('SELECT id FROM club_application WHERE name = ? AND status IN (0, 1)', [name]);
      if (dup.length > 0) return fail(48002, '该社团名称已在申请或已通过，请换一个');

      const r = await query(
        'INSERT INTO club_application (name, location, content, outline, activity_time, proposer_id) VALUES (?, ?, ?, ?, ?, ?)',
        [name, location, content, outline, activityTime, userId],
      );
      return ok({ id: r.insertId }, '社团申请已提交，等待教务处审批');
    }

    if (action === 'review') {
      if (!roles.some((r) => ['admin', 'teacher'].includes(r))) {
        throw ERR_FORBIDDEN('仅教务处（教师/管理员）可审批社团申请');
      }
      const id = Number(body.id);
      const pass = Boolean(body.pass);
      const opinion = String(body.opinion || '').trim().slice(0, 256);
      const rows = await query('SELECT id, name, status FROM club_application WHERE id = ?', [id]);
      if (rows.length === 0) return fail(48004, '申请不存在');
      if (Number(rows[0].status) !== 0) return fail(48005, '该申请已审批');
      await query(
        'UPDATE club_application SET status = ?, review_opinion = ?, reviewer_id = ?, reviewed_at = NOW() WHERE id = ?',
        [pass ? 1 : 2, opinion || (pass ? '同意' : '不符合要求'), userId, id],
      );
      await opLog(userId, 'club.review', `club-apply:${id}`, `${rows[0].name} ${pass ? '通过' : '驳回'}`, ip);
      return ok({ id, status: pass ? 1 : 2 }, pass ? '已通过，可在"社团活动"页发布招聘' : '已驳回');
    }

    return fail(48001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
