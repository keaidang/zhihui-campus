// /api/lib/loans — 借阅/归还/借阅记录
// GET  ?scope=mine|all          mine=我的借阅；all=admin 借阅管理
// POST { action: 'borrow' | 'return', bookId | loanId }
// 借阅规则：每人同时在借 ≤ 5 本；同一本未还不能重复借；借期 30 天
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog, ERR_FORBIDDEN } from '../../lib/guard.js';
import { query, withTransaction } from '../../lib/db.js';

export { preflight as onRequestOptions };

const LOAN_DAYS = 30;
const MAX_ACTIVE = 5;

export async function onRequestGet(context) {
  try {
    const { userId, roles } = await requireRoles(context);
    const url = new URL(context.request.url);
    const scope = url.searchParams.get('scope') || 'mine';
    const isAdmin = roles.includes('admin');

    const where = [];
    const params = [];
    if (scope === 'all' && isAdmin) {
      const status = url.searchParams.get('status');
      if (status === 'active') where.push('l.status = 0');
      else if (status === 'returned') where.push('l.status = 1');
      const kw = String(url.searchParams.get('keyword') || '').trim();
      if (kw) {
        where.push('(b.title LIKE ? OR u.real_name LIKE ? OR u.username LIKE ?)');
        const like = `%${kw}%`;
        params.push(like, like, like);
      }
    } else {
      where.push('l.user_id = ?');
      params.push(userId);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query(
      `SELECT l.id, l.book_id AS bookId, l.status, l.borrowed_at AS borrowedAt, l.due_at AS dueAt,
              l.returned_at AS returnedAt,
              b.title, b.author, b.isbn, b.location,
              u.real_name AS borrowerName, u.username
         FROM lib_loan l
         JOIN lib_book b ON b.id = l.book_id
         JOIN sys_user u ON u.id = l.user_id
        ${whereSql}
        ORDER BY l.id DESC
        LIMIT 200`,
      params,
    );
    const list = rows.map((r) => ({
      ...r,
      overdue: r.status === 0 && new Date(r.dueAt) < new Date(),
    }));
    return ok({ list, canManage: isAdmin });
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

    if (action === 'borrow') {
      const bookId = Number(body.bookId);
      const books = await query('SELECT id, title, available_copies AS avail FROM lib_book WHERE id = ?', [bookId]);
      if (books.length === 0) return fail(46010, '图书不存在');
      if (Number(books[0].avail) <= 0) return fail(46011, '该书包全部借出，暂无可借副本');

      const dup = await query('SELECT id FROM lib_loan WHERE book_id = ? AND user_id = ? AND status = 0', [bookId, userId]);
      if (dup.length > 0) return fail(46012, '您已借阅此书且未归还');

      const active = await query('SELECT COUNT(*) n FROM lib_loan WHERE user_id = ? AND status = 0', [userId]);
      if (Number(active[0].n) >= MAX_ACTIVE) return fail(46013, `同时在借不能超过 ${MAX_ACTIVE} 本`);

      // 条件更新扣库存，affectedRows=0 说明被并发借空
      const dec = await query('UPDATE lib_book SET available_copies = available_copies - 1 WHERE id = ? AND available_copies > 0', [bookId]);
      if (dec.affectedRows === 0) return fail(46011, '手慢了，该书刚被借完');
      try {
        const ins = await query(
          'INSERT INTO lib_loan (book_id, user_id, due_at) VALUES (?, ?, NOW() + INTERVAL ? DAY)',
          [bookId, userId, LOAN_DAYS],
        );
        return ok({ loanId: ins.insertId, dueDays: LOAN_DAYS }, `借阅成功，${LOAN_DAYS} 天内归还`);
      } catch (e) {
        // 补偿：借阅记录写入失败时回滚库存
        await query('UPDATE lib_book SET available_copies = available_copies + 1 WHERE id = ?', [bookId]);
        throw e;
      }
    }

    if (action === 'return') {
      const loanId = Number(body.loanId);
      const loans = await query('SELECT id, book_id, user_id, status FROM lib_loan WHERE id = ?', [loanId]);
      if (loans.length === 0) return fail(46014, '借阅记录不存在');
      const loan = loans[0];
      const isOwner = Number(loan.user_id) === userId;
      const isAdmin = roles.includes('admin');
      if (!isOwner && !isAdmin) throw ERR_FORBIDDEN('只能归还本人的借阅');
      if (Number(loan.status) !== 0) return fail(46015, '该书记录已归还');

      // 逾期标记：2=逾期归还
      const overdue = await query('SELECT (due_at < NOW()) od FROM lib_loan WHERE id = ?', [loanId]);
      const wasOverdue = Number(overdue[0].od) === 1;
      await withTransaction(async (conn) => {
        await conn.query('UPDATE lib_loan SET status = ?, returned_at = NOW() WHERE id = ?', [wasOverdue ? 2 : 1, loanId]);
        await conn.query('UPDATE lib_book SET available_copies = LEAST(total_copies, available_copies + 1) WHERE id = ?', [loan.book_id]);
      });
      await opLog(userId, 'lib.return', `loan:${loanId}`, wasOverdue ? '逾期归还' : '正常归还', ip);
      return ok({ loanId }, wasOverdue ? '已归还（该书已逾期）' : '归还成功');
    }

    return fail(46001, '不支持的操作');
  } catch (e) {
    return jsonError(e);
  }
}
