// /api/ai/kb — 校园知识库管理（仅超管）
//
// GET  ?keyword=&category=&page=   知识库条目列表（含分类汇总与总字数）
// POST { action:'upsert'|'delete'|'status', ... }  增删改
//
// 说明：知识库的**唯一数据源是 scripts/seed-ai-kb.mjs**（避免正文漂移，见该脚本注释）。
// 本接口用于运行期的小修小补（改错别字、临时下架某条），改动会在下次 seed 时被覆盖 ——
// 所以列表接口会**明确提示这一点**，不让管理员误以为它能当长期编辑器用。
import { ok, fail, jsonError, readBody, preflight } from '../../lib/http.js';
import { actorFrom } from '../../lib/services/_actor.js';
import { opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { invalidateKbCache, kbTotalChars } from '../../lib/ai-kb.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    await actorFrom(context, ['admin']);
    const url = new URL(context.request.url);
    const keyword = String(url.searchParams.get('keyword') || '').trim().slice(0, 32);
    const category = String(url.searchParams.get('category') || '').trim().slice(0, 32);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || 20)));

    const where = ['1 = 1'];
    const params = [];
    if (keyword) {
      where.push('(title LIKE ? OR keywords LIKE ? OR content LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }
    if (category) {
      where.push('category = ?');
      params.push(category);
    }
    const whereSql = where.join(' AND ');

    const [{ total }] = await query(`SELECT COUNT(*) AS total FROM ai_kb WHERE ${whereSql}`, params);
    const rows = await query(
      `SELECT id, category, title, keywords, CHAR_LENGTH(content) AS content_len, sort, status, updated_at
         FROM ai_kb WHERE ${whereSql} ORDER BY sort ASC, id ASC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const cats = await query('SELECT category, COUNT(*) AS n FROM ai_kb WHERE status = 1 GROUP BY category ORDER BY n DESC');
    return ok({
      list: rows,
      total: Number(total),
      page,
      pageSize,
      categories: cats,
      totalChars: await kbTotalChars(),
      note: '知识库唯一数据源是 scripts/seed-ai-kb.mjs（docs/AI-KB-CONTENT.md 为自动渲染）。此处的临时修改会在下次 seed 时被覆盖。',
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const actor = await actorFrom(context, ['admin']);
    const body = await readBody(context.request, 32 * 1024);
    const action = String(body.action || '');

    if (action === 'upsert') {
      const id = Number(body.id) || 0;
      const category = String(body.category || '').trim().slice(0, 32);
      const title = String(body.title || '').trim().slice(0, 128);
      const keywords = String(body.keywords || '').trim().slice(0, 255);
      const content = String(body.content || '').trim().slice(0, 8000);
      if (!category || !title || !content) return fail(49401, '分类、标题、正文都不能为空');
      if (id) {
        await query('UPDATE ai_kb SET category = ?, title = ?, keywords = ?, content = ? WHERE id = ?', [category, title, keywords, content, id]);
      } else {
        const dup = await query('SELECT id FROM ai_kb WHERE category = ? AND title = ?', [category, title]);
        if (dup.length) return fail(49401, '同分类下已存在同名条目');
        await query('INSERT INTO ai_kb (category, title, keywords, content, sort, status) VALUES (?, ?, ?, ?, 999, 1)', [category, title, keywords, content]);
      }
      invalidateKbCache();
      await opLog(actor.userId, 'ai.kb.upsert', `kb:${id || 'new'}`, title, actor.ip);
      return ok({ id: id || null }, '已保存（下次 seed 会被脚本内容覆盖）');
    }

    if (action === 'status' || action === 'delete') {
      const id = Number(body.id);
      if (!id) return fail(49401, '缺少 id');
      if (action === 'delete') {
        await query('DELETE FROM ai_kb WHERE id = ?', [id]);
        await opLog(actor.userId, 'ai.kb.delete', `kb:${id}`, '', actor.ip);
      } else {
        const status = Number(body.status) === 1 ? 1 : 0;
        await query('UPDATE ai_kb SET status = ? WHERE id = ?', [status, id]);
        await opLog(actor.userId, 'ai.kb.status', `kb:${id}`, String(status), actor.ip);
      }
      invalidateKbCache();
      return ok({ id }, action === 'delete' ? '已删除' : '状态已更新');
    }

    return fail(49401, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
