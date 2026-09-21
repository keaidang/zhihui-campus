// /api/af/notice — 公告
// GET  全校公告 + 本院公告（staff 可见全部）
// POST { action: 'publish' | 'revoke' | 'pin' }  发布者: teacher/counselor/admin
import { ok, fail, jsonError, readBody, preflight, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    const { roles, deptId } = await requireRoles(context);
    const url = new URL(context.request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || 10)));

    const staff = roles.some((r) => ['admin', 'counselor', 'teacher', 'leader'].includes(r));
    const where = ['n.status = 1'];
    const params = [];
    if (!staff) {
      // 学生: 全校公告 + 本院公告
      where.push('(n.dept_id IS NULL OR n.dept_id = ?)');
      params.push(deptId || 0);
    }

    const [[{ total }]] = [
      await query(`SELECT COUNT(*) AS total FROM af_notice n WHERE ${where.join(' AND ')}`, params),
    ];
    const rows = await query(
      `SELECT n.id, n.title, n.content, n.pinned, n.created_at, n.dept_id,
              d.name AS dept_name, COALESCE(u.real_name, '系统管理员') AS publisher_name
         FROM af_notice n
         LEFT JOIN sys_department d ON d.id = n.dept_id
         LEFT JOIN sys_user u ON u.id = n.publisher_id
        WHERE ${where.join(' AND ')}
        ORDER BY n.pinned DESC, n.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return ok({ list: rows, total: Number(total), page, pageSize });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId, roles, deptId } = await requireRoles(context, ['teacher', 'counselor', 'admin']);
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || 'publish');
    const isAdmin = roles.includes('admin');

    if (action === 'publish') {
      const title = String(body.title || '').trim().slice(0, 128);
      const content = String(body.content || '').trim().slice(0, 8000);
      if (!title || !content) return fail(45001, '标题和内容不能为空');
      // 院系定向：counselor 强制本院；teacher 只能本院或全校？收口为 counselor/teacher 均强制本院
      let targetDept = null;
      if (!isAdmin) {
        if (!deptId) throw ERR_FORBIDDEN('未归属院系，不能发布公告');
        targetDept = deptId;
      } else if (body.deptId) {
        targetDept = Number(body.deptId);
      }
      const pinned = isAdmin && Number(body.pinned) === 1 ? 1 : 0;
      const r = await query('INSERT INTO af_notice (title, content, publisher_id, dept_id, pinned) VALUES (?, ?, ?, ?, ?)', [
        title,
        content,
        userId,
        targetDept,
        pinned,
      ]);
      await opLog(userId, 'notice.publish', `notice:${r.insertId}`, title, ip);
      return ok({ id: r.insertId }, '公告已发布');
    }

    if (action === 'revoke' || action === 'pin') {
      const id = Number(body.id);
      const rows = await query('SELECT id, publisher_id, pinned FROM af_notice WHERE id = ?', [id]);
      if (rows.length === 0) return fail(45004, '公告不存在');
      const n = rows[0];
      if (!isAdmin && n.publisher_id !== userId) throw ERR_FORBIDDEN('只能管理自己发布的公告');
      if (action === 'revoke') {
        await query('UPDATE af_notice SET status = 0 WHERE id = ?', [id]);
        await opLog(userId, 'notice.revoke', `notice:${id}`, '', ip);
        return ok({ id }, '公告已撤回');
      }
      if (!isAdmin) throw ERR_FORBIDDEN('仅管理员可置顶公告');
      await query('UPDATE af_notice SET pinned = ? WHERE id = ?', [n.pinned === 1 ? 0 : 1, id]);
      return ok({ id, pinned: n.pinned === 1 ? 0 : 1 }, n.pinned === 1 ? '已取消置顶' : '已置顶');
    }

    return fail(45001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
