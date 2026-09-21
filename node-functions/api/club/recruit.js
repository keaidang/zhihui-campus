// /api/club/recruit — 社团招聘（审批通过后发布）+ 预约/取消
// GET  招募中的招聘列表（全员）+ 我的预约状态；?scope=mine 我的预约
// POST { action: 'publish' | 'stop' | 'book' | 'cancel' }
//   publish: 申请通过后的开课人/教务处(teacher/admin) 发布 { applicationId, title, content, images, quota }
//   stop   : 停止招募（发布人/admin）
//   book   : 学生预约占名额（事务：名额条件更新 + 占位写入）
//   cancel : 取消预约释放名额
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const { userId } = await requireRoles(context);
    const url = new URL(context.request.url);
    const scope = url.searchParams.get('scope') || 'list';

    if (scope === 'mine') {
      // ★ location/activity_time 在 club_application（club_recruit 无此字段，此前误引用 r.activity_time 导致 500）
      const rows = await query(
        `SELECT bk.id, bk.recruit_id AS recruitId, bk.canceled_at AS canceledAt, bk.created_at AS bookedAt,
                r.title, r.status, a.location, a.activity_time AS activityTime
           FROM club_booking bk
           JOIN club_recruit r ON r.id = bk.recruit_id
           JOIN club_application a ON a.id = r.application_id
          WHERE bk.user_id = ?
          ORDER BY bk.id DESC
          LIMIT 50`,
        [userId],
      );
      return ok({ list: rows.map((r) => ({ ...r, active: !r.canceledAt })) });
    }

    // list：招募中的 + 我是否已预约
    const rows = await query(
      `SELECT r.id, r.application_id AS applicationId, r.title, r.content, r.images, r.quota, r.taken,
              r.status, r.created_at AS createdAt,
              a.name AS clubName, a.location, a.activity_time AS activityTime, a.content AS clubContent,
              u.real_name AS publisherName,
              p.real_name AS proposerName
         FROM club_recruit r
         JOIN club_application a ON a.id = r.application_id
         JOIN sys_user u ON u.id = r.publisher_id
         JOIN sys_user p ON p.id = a.proposer_id
        ORDER BY r.status DESC, r.id DESC
        LIMIT 100`,
    );
    const myBookings = await query('SELECT recruit_id AS rid FROM club_booking WHERE user_id = ? AND canceled_at IS NULL', [userId]);
    const bookedSet = new Set(myBookings.map((b) => Number(b.rid)));
    const list = rows.map((r) => {
      let imgs = [];
      try {
        imgs = JSON.parse(r.images || '[]');
      } catch {
        imgs = [];
      }
      return { ...r, images: imgs, booked: bookedSet.has(Number(r.id)) };
    });
    return ok({ list });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const ip = clientIp(context.request);
    const body = await readBody(context.request, 64 * 1024);
    const action = String(body.action || '');
    const isEdu = roles.some((r) => ['admin', 'teacher'].includes(r));

    if (action === 'publish') {
      const applicationId = Number(body.applicationId);
      const apps = await query('SELECT id, name, status, proposer_id FROM club_application WHERE id = ?', [applicationId]);
      if (apps.length === 0) return fail(48010, '社团申请不存在');
      const app = apps[0];
      if (Number(app.status) !== 1) return fail(48011, '该社团申请尚未通过审批');
      if (Number(app.proposer_id) !== userId && !isEdu) throw ERR_FORBIDDEN('仅开课人或教务处可发布招聘');

      const title = String(body.title || app.name).trim().slice(0, 128);
      const content = String(body.content || '').trim().slice(0, 1024);
      const quota = Math.max(0, Math.min(999, Number(body.quota) || 0));
      let images = [];
      if (Array.isArray(body.images)) {
        images = body.images
          .map((u) => String(u).trim())
          .filter((u) => /^\/api\/blob\?token=[a-z0-9]{16}$/.test(u) || /^https?:\/\//.test(u))
          .slice(0, 6);
      }
      const existed = await query('SELECT id FROM club_recruit WHERE application_id = ?', [applicationId]);
      if (existed.length > 0) return fail(48012, '该社团已发布过招聘，请直接编辑或停止后重发');

      const r = await query(
        'INSERT INTO club_recruit (application_id, title, content, images, quota, publisher_id) VALUES (?, ?, ?, ?, ?, ?)',
        [applicationId, title, content, JSON.stringify(images), quota, userId],
      );
      await opLog(userId, 'club.publish', `recruit:${r.insertId}`, app.name, ip);
      return ok({ id: r.insertId }, '招聘已发布，全员可见');
    }

    if (action === 'stop') {
      const id = Number(body.id);
      const rows = await query('SELECT id, publisher_id, status FROM club_recruit WHERE id = ?', [id]);
      if (rows.length === 0) return fail(48014, '招聘不存在');
      if (Number(rows[0].publisher_id) !== userId && !isEdu) throw ERR_FORBIDDEN();
      if (Number(rows[0].status) !== 1) return fail(48015, '招募已停止');
      await query('UPDATE club_recruit SET status = 0 WHERE id = ?', [id]);
      await opLog(userId, 'club.stop', `recruit:${id}`, '', ip);
      return ok({ id }, '已停止招募');
    }

    if (action === 'book') {
      const id = Number(body.id);
      const rows = await query('SELECT id, quota, taken, status FROM club_recruit WHERE id = ?', [id]);
      if (rows.length === 0) return fail(48014, '招聘不存在');
      const rec = rows[0];
      if (Number(rec.status) !== 1) return fail(48016, '该招聘已停止');
      if (Number(rec.quota) > 0 && Number(rec.taken) >= Number(rec.quota)) return fail(48017, '名额已满');

      // 事务：占位记录（唯一键防重复）+ 名额条件更新
      try {
        await withTransaction(async (conn) => {
          const [exist] = await conn.query('SELECT id, canceled_at FROM club_booking WHERE recruit_id = ? AND user_id = ? FOR UPDATE', [id, userId]);
          if (exist && exist.length > 0 && !exist[0].canceled_at) throw Object.assign(new Error('dup'), { biz: true });
          if (exist && exist.length > 0) {
            await conn.query('UPDATE club_booking SET canceled_at = NULL WHERE id = ?', [exist[0].id]);
          } else {
            await conn.query('INSERT INTO club_booking (recruit_id, user_id) VALUES (?, ?)', [id, userId]);
          }
          if (Number(rec.quota) > 0) {
            const [upd] = await conn.query('UPDATE club_recruit SET taken = taken + 1 WHERE id = ? AND taken < quota', [id]);
            if (upd.affectedRows === 0) throw Object.assign(new Error('full'), { biz: true });
          }
        });
      } catch (e) {
        if (e && e.biz) {
          return e.message === 'dup' ? fail(48018, '您已预约过该社团') : fail(48017, '手慢了，名额刚被约满');
        }
        throw e;
      }
      return ok({ id }, '预约成功，已占用一个名额');
    }

    if (action === 'cancel') {
      const id = Number(body.id);
      const rows = await query('SELECT id, quota FROM club_recruit WHERE id = ?', [id]);
      if (rows.length === 0) return fail(48014, '招聘不存在');
      const bks = await query('SELECT id FROM club_booking WHERE recruit_id = ? AND user_id = ? AND canceled_at IS NULL', [id, userId]);
      if (bks.length === 0) return fail(48019, '您尚未预约该社团');
      await withTransaction(async (conn) => {
        const [upd] = await conn.query('UPDATE club_booking SET canceled_at = NOW() WHERE id = ?', [bks[0].id]);
        if (upd.affectedRows === 0) throw Object.assign(new Error('dup'), { biz: true });
        if (Number(rows[0].quota) > 0) {
          await conn.query('UPDATE club_recruit SET taken = GREATEST(taken - 1, 0) WHERE id = ?', [id]);
        }
      });
      return ok({ id }, '已取消预约，名额已释放');
    }

    return fail(48001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
