// /api/forum/boards — 论坛板块列表（含各板块帖子数）
// GET → { list: [{id, name, description, isTrade, sort, threads}] }
import { ok, jsonError, preflight } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    await requireRoles(context); // 仅登录用户可访问论坛（合规要求）
    const rows = await query(
      `SELECT b.id, b.name, b.description, b.is_trade AS isTrade, b.sort,
              (SELECT COUNT(*) FROM forum_thread t WHERE t.board_id = b.id AND t.status = 1) AS threads
         FROM forum_board b
        WHERE b.status = 1
        ORDER BY b.sort ASC, b.id ASC`,
    );
    return ok({ list: rows });
  } catch (e) {
    return jsonError(e);
  }
}
