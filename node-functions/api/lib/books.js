// /api/lib/books — 图书检索与管理
// GET  ?keyword=&category=&page=&pageSize=   需登录（学生搜索/详情）
// POST { action }  admin 专用：
//   add    { book: {...} } 或 { books: [...] }  单本/批量添加
//   import { rows: [...] }                      批量导入（同 batch，字段更宽松）
//   update { id, ...fields }
//   delete { id }
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';

export { preflight as onRequestOptions };

const CATEGORIES = ['计算机', 'AI', '金融', '文学', '历史', '科学', '艺术', '教育', '综合'];
const STR = (v, n) => String(v ?? '').trim().slice(0, n);

function normalizeBook(b) {
  return {
    title: STR(b.title, 128),
    author: STR(b.author, 64),
    isbn: STR(b.isbn, 20),
    publisher: STR(b.publisher, 64),
    category: CATEGORIES.includes(b.category) ? b.category : '综合',
    coverUrl: STR(b.coverUrl || b.cover_url, 256),
    location: STR(b.location, 64),
    copies: Math.max(1, Math.min(99, Number(b.copies ?? b.total_copies ?? 1) || 1)),
  };
}

export async function onRequestGet(context) {
  try {
    await requireRoles(context);
    const url = new URL(context.request.url);
    const keyword = STR(url.searchParams.get('keyword'), 64);
    const category = url.searchParams.get('category') || '';
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize')) || 12));

    const where = [];
    const params = [];
    if (keyword) {
      where.push('(b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }
    if (category && CATEGORIES.includes(category)) {
      where.push('b.category = ?');
      params.push(category);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = await query(`SELECT COUNT(*) n FROM lib_book b ${whereSql}`, params);
    const rows = await query(
      `SELECT b.id, b.title, b.author, b.isbn, b.publisher, b.category, b.cover_url AS coverUrl,
              b.location, b.total_copies AS totalCopies, b.available_copies AS availableCopies,
              b.ext_source AS extSource, b.ext_id AS extId, b.created_at AS createdAt
         FROM lib_book b ${whereSql}
        ORDER BY b.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    return ok({ list: rows, total: Number(total[0].n), page, pageSize });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { userId } = await requireRoles(context, ['admin']);
    const ip = clientIp(context.request);
    const body = await readBody(context.request, 1024 * 1024); // 批量导入可能较大
    const action = String(body.action || '');

    if (action === 'add' || action === 'import') {
      const list = Array.isArray(body.books) ? body.books : Array.isArray(body.rows) ? body.rows : body.book ? [body.book] : [];
      if (list.length === 0) return fail(46001, '请提供书籍数据');
      if (list.length > 500) return fail(46002, '单次最多导入 500 本');
      let inserted = 0;
      const skipped = [];
      for (const raw of list) {
        const b = normalizeBook(raw);
        if (!b.title) {
          skipped.push({ title: STR(raw?.title, 32) || '(空)', reason: '缺少书名' });
          continue;
        }
        // ISBN 去重（有 ISBN 才查）
        if (b.isbn) {
          const dup = await query('SELECT id FROM lib_book WHERE isbn = ?', [b.isbn]);
          if (dup.length > 0) {
            skipped.push({ title: b.title, reason: `ISBN 已存在` });
            continue;
          }
        }
        await query(
          `INSERT INTO lib_book (title, author, isbn, publisher, category, cover_url, location, total_copies, available_copies, ext_source, ext_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [b.title, b.author, b.isbn, b.publisher, b.category, b.coverUrl, b.location, b.copies, b.copies, STR(raw.extSource, 32), STR(raw.extId, 64)],
        );
        inserted++;
      }
      await opLog(userId, `lib.${action}`, 'batch', `inserted=${inserted} skipped=${skipped.length}`, ip);
      return ok({ inserted, skipped }, `导入完成：新增 ${inserted} 本${skipped.length ? `，跳过 ${skipped.length} 本` : ''}`);
    }

    if (action === 'update') {
      const id = Number(body.id);
      const rows = await query('SELECT id FROM lib_book WHERE id = ?', [id]);
      if (rows.length === 0) return fail(46004, '图书不存在');
      const b = normalizeBook({ ...body });
      await query(
        `UPDATE lib_book SET title=?, author=?, isbn=?, publisher=?, category=?, cover_url=?, location=?,
            total_copies=GREATEST(available_copies, ?), ext_source=?, ext_id=? WHERE id=?`,
        [b.title, b.author, b.isbn, b.publisher, b.category, b.coverUrl, b.location, b.copies, STR(body.extSource, 32), STR(body.extId, 64), id],
      );
      await opLog(userId, 'lib.update', `book:${id}`, b.title, ip);
      return ok({ id }, '图书信息已更新');
    }

    if (action === 'delete') {
      const id = Number(body.id);
      const active = await query('SELECT COUNT(*) n FROM lib_loan WHERE book_id = ? AND status = 0', [id]);
      if (Number(active[0].n) > 0) return fail(46005, '该书尚有借出未还，不能删除');
      await query('DELETE FROM lib_book WHERE id = ?', [id]);
      await opLog(userId, 'lib.delete', `book:${id}`, '', ip);
      return ok({ id }, '已删除');
    }

    return fail(46001, '不支持的操作');
  } catch (e) {
    if (e && e.message === 'body too large') return fail(46003, '导入文件过大，请分批导入');
    return jsonError(e);
  }
}
