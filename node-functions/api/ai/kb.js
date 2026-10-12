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
import { aiConfigured, aiJson, aiModel, logAiUsage } from '../../lib/ai.js';
import { getBool } from '../../lib/ai-config.js';
import { consumeAiQuota, releaseAiQuota } from '../../lib/ai-guard.js';

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

    // C18 智能长文档切分
    if (action === 'parse_doc') {
      const docText = String(body.docText || '').trim();
      const defaultCategory = String(body.defaultCategory || 'guide').trim().slice(0, 32);
      if (!docText) return fail(49401, '请提供需要解析拆分的文档正文');
      if (docText.length > 8000) return fail(49401, '单次解析长文档请控制在 8000 字以内');

      if (!aiConfigured()) return fail(49400, 'AI 解析服务暂未配置', 503);
      if (!(await getBool('ai.enabled', true))) return fail(49430, 'AI 服务已被管理员关闭', 503);

      const quota = await consumeAiQuota(actor.userId, 'chat');
      if (!quota.ok) return fail(49429, quota.message, 429);

      const t0 = Date.now();
      try {
        const systemPrompt = [
          '你是一位高校数字校园知识库整理专家。',
          '请将输入的校园规章制度、办事手册或长文档通知，按独立事务/问答拆分成多条清晰的知识库条目。',
          '条目字段要求：',
          '- title: 该条目解答的问题或主题（例如「校园电动自行车充电与停放规定」），10-30字',
          `- category: 分类英文标识，优先使用 [dept, faq, guide, leave, repair, elect, lib, dorm, mail, life]，若无匹配则用 "${defaultCategory}"`,
          '- keywords: 3-5个检索关键词，逗号分隔（例如「电动车,充电,宿舍充电,违规停放」）',
          '- content: 权威准确、语言规范、条理清晰的事实性内容（150-400字）',
          '',
          '输出纯 JSON 对象：{"items": [{"title": "...", "category": "...", "keywords": "...", "content": "..."}]}',
        ].join('\n');

        const parsed = await aiJson({
          system: systemPrompt,
          user: `【原始长文档正文】：\n${docText}`,
          maxTokens: 1400,
          timeoutMs: 22000,
        });

        if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) {
          await logAiUsage({ userId: actor.userId, kind: 'kb_parse', model: aiModel(), ok: 0, costMs: Date.now() - t0 });
          return fail(49430, '长文档智能切分失败，请检查文本或重试', 503);
        }

        await logAiUsage({ userId: actor.userId, kind: 'kb_parse', model: aiModel(), ok: 1, costMs: Date.now() - t0 });
        const items = parsed.items.map((it) => ({
          title: String(it.title || '').trim().slice(0, 128),
          category: String(it.category || defaultCategory).trim().slice(0, 32),
          keywords: String(it.keywords || '').trim().slice(0, 255),
          content: String(it.content || '').trim().slice(0, 4000),
        })).filter((it) => it.title && it.content);

        return ok({ items });
      } finally {
        releaseAiQuota(actor.userId);
      }
    }

    // C18 批量入库
    if (action === 'batch_insert') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return fail(49401, '请提供要入库的条目列表');
      let inserted = 0;
      let skipped = 0;
      for (const it of items) {
        const title = String(it.title || '').trim().slice(0, 128);
        const category = String(it.category || 'guide').trim().slice(0, 32);
        const keywords = String(it.keywords || '').trim().slice(0, 255);
        const content = String(it.content || '').trim().slice(0, 8000);
        if (!title || !content) {
          skipped++;
          continue;
        }
        const dup = await query('SELECT id FROM ai_kb WHERE category = ? AND title = ?', [category, title]);
        if (dup.length) {
          skipped++;
          continue;
        }
        await query(
          'INSERT INTO ai_kb (category, title, keywords, content, sort, status) VALUES (?, ?, ?, ?, 999, 1)',
          [category, title, keywords, content],
        );
        inserted++;
      }
      invalidateKbCache();
      await opLog(actor.userId, 'ai.kb.batch_insert', 'kb:batch', `入库 ${inserted} 条，跳过 ${skipped} 条`, actor.ip);
      return ok({ inserted, skipped }, `成功入库 ${inserted} 条${skipped ? `（跳过 ${skipped} 条重复或空项）` : ''}`);
    }

    return fail(49401, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
