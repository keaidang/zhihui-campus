// /api/admin/mailbox — 管理员：校园邮箱开通/关闭/查看密码/导出
// GET            全量邮箱状态列表（**不下发明文密码**）；?export=csv 导出含明文密码（仅 admin，高敏感，必留审计）
// POST {action: 'enable'|'disable'|'resetPassword'|'viewPassword'|'updateAddress', userId}
//   enable:  为用户在邮件服务器创建真实邮箱（localPart 取自 campus_email 前缀），
//            随机密码存库（管理员可见可导出，用户可登录邮件系统后修改）
//   disable: 关闭对外收发（保留服务器邮箱）
//   resetPassword: 重置邮箱密码（随机生成，返回新密码）
//   viewPassword:  查看单个用户的邮箱密码（高敏感，每次查看都写 opLog）
// ★ 审计口径：明文密码只从两条路径出去——CSV 导出与单个查看，二者都写 opLog；
//   列表接口一律剥离 mail_password，避免"静默批量取走全部密码"。
import { ok, fail, jsonError, preflight, readBody, clientIp } from '../../lib/http.js';
import { requireRoles, opLog } from '../../lib/guard.js';
import { query } from '../../lib/db.js';
import { createMailbox, resetMailboxPassword, lanqinConfigured, isLocalPartTaken, isDomainAllowed } from '../../lib/lanqin.js';

export { preflight as onRequestOptions };

const randomPwd = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!';
  let p = '';
  for (let i = 0; i < 12; i++) p += chars[(Math.random() * chars.length) | 0];
  return p;
};

export async function onRequestGet(context) {
  try {
    const { userId: operatorId } = await requireRoles(context, ['admin']);
    const url = new URL(context.request.url);
    const ip = clientIp(context.request);
    const rows = await query(
      `SELECT u.id, u.username, u.real_name, u.user_no, u.email, u.campus_email,
              u.mail_enabled, u.mail_password, u.mail_created_at, d.name AS dept_name
         FROM sys_user u
         LEFT JOIN sys_department d ON d.id = u.dept_id
        WHERE u.campus_email IS NOT NULL
        ORDER BY u.campus_email`,
    );
    if (url.searchParams.get('export') === 'csv') {
      // 该响应体含全校明文邮箱密码 —— 高敏感动作，先留痕再返回
      await opLog(operatorId, 'mailbox.export', `count:${rows.length}`, 'CSV 含明文邮箱密码', ip);
      const lines = ['校园邮箱,姓名,账号,学工号,部门,对外收发,邮箱密码,创建时间'];
      for (const r of rows) {
        const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        lines.push([
          esc(r.campus_email), esc(r.real_name), esc(r.username), esc(r.user_no), esc(r.dept_name),
          r.mail_enabled ? '已开通' : '未开通', esc(r.mail_enabled ? r.mail_password : ''),
          esc(r.mail_created_at ? new Date(r.mail_created_at).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) : ''),
        ].join(','));
      }
      return new Response('\ufeff' + lines.join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="campus-emails-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    // 列表一律剥离明文密码（含管理员）：要看单个用户的密码请走 POST action=viewPassword
    return ok({ list: rows.map((r) => ({ ...r, mail_password: undefined })) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function onRequestPost(context) {
  try {
    const { roles, userId: operatorId } = await requireRoles(context, ['admin']);
    if (!roles.includes('admin')) return fail(40301, '仅超级管理员可操作');
    const ip = clientIp(context.request);
    const body = await readBody(context.request);
    const action = String(body.action || '');
    const userId = Number(body.userId);
    if (!userId) return fail(43200, '缺少 userId');

    const users = await query(
      'SELECT id, username, real_name, campus_email, mail_enabled, mail_mailbox_id, mail_password FROM sys_user WHERE id = ?',
      [userId],
    );
    if (!users.length) return fail(43200, '用户不存在');
    const u = users[0];

    // 查看单个用户邮箱密码（高敏感：每次查看都留痕，可追溯是谁在什么时候看了谁的密码）
    if (action === 'viewPassword') {
      await opLog(operatorId, 'mailbox.viewPassword', `user:${userId}`, u.campus_email || '', ip);
      return ok({ campusEmail: u.campus_email, password: u.mail_password });
    }

    if (action === 'enable') {
      if (!u.campus_email) return fail(43201, '该用户尚未分配校园邮箱地址');
      if (!lanqinConfigured()) return fail(43202, '邮件服务未配置（缺少 LANQIN_* 环境变量）');
      if (u.mail_mailbox_id) {
        // 已有服务器邮箱，仅恢复开关
        await query('UPDATE sys_user SET mail_enabled = 1 WHERE id = ?', [userId]);
        return ok({ campusEmail: u.campus_email, password: u.mail_password }, '对外收发已开启');
      }
      const localPart = String(u.campus_email).split('@')[0];
      const userDomain = String(u.campus_email).split('@')[1] || 'keaidang.com';
      const pwd = u.mail_password || randomPwd();
      const r = await createMailbox(localPart, pwd, u.real_name, userDomain);
      if (!r.ok) return fail(43203, `邮件服务器创建失败：${r.error}`);
      await query(
        'UPDATE sys_user SET mail_enabled = 1, mail_mailbox_id = ?, mail_password = ?, mail_created_at = NOW() WHERE id = ?',
        [r.mailboxId, pwd, userId],
      );
      await opLog(operatorId, 'mailbox.enable', `user:${userId}`, r.address, ip);
      return ok({ campusEmail: r.address, password: pwd }, `邮箱已开通：${r.address}（初始密码见返回，请妥善告知用户）`);
    }

    if (action === 'disable') {
      await query('UPDATE sys_user SET mail_enabled = 0 WHERE id = ?', [userId]);
      await opLog(operatorId, 'mailbox.disable', `user:${userId}`, '', ip);
      return ok(null, '对外收发已关闭');
    }

    if (action === 'resetPassword') {
      if (!u.mail_mailbox_id) return fail(43204, '该用户未开通真实邮箱');
      const pwd = randomPwd();
      const r = await resetMailboxPassword(u.mail_mailbox_id, pwd);
      if (!r.ok) return fail(43205, `密码重置失败：${r.error}`);
      await query('UPDATE sys_user SET mail_password = ? WHERE id = ?', [pwd, userId]);
      await opLog(operatorId, 'mailbox.resetPassword', `user:${userId}`, '', ip);
      return ok({ password: pwd }, '邮箱密码已重置');
    }

    // 修改校园邮箱地址（仅系统内地址；已开通真实邮箱的需先关闭对外收发）
    if (action === 'updateAddress') {
      const PREFIX_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
      const prefix = String(body.prefix || '').trim().toLowerCase();
      const domain = String(body.domain || 'keaidang.com').trim().toLowerCase();
      if (!PREFIX_RE.test(prefix)) return fail(43210, '前缀格式：字母或数字开头，3~30 位小写字母/数字/._-');
      const newEmail = `${prefix}@${domain}`;
      if (newEmail === u.campus_email) return ok({ campusEmail: newEmail }, '地址未变化');
      if (u.mail_mailbox_id) return fail(43211, '该用户已开通真实邮箱，请先关闭对外收发再修改地址');
      const domOk = await isDomainAllowed(domain);
      if (!domOk) return fail(43214, '该邮箱域名不可用，请重新选择');
      const dup = await query('SELECT id FROM sys_user WHERE campus_email = ?', [newEmail]);
      if (dup.length) return fail(43212, '该前缀已被占用');
      const taken = await isLocalPartTaken(prefix);
      if (taken) return fail(43213, '该前缀在邮件服务器已被占用');
      await query('UPDATE sys_user SET campus_email = ? WHERE id = ?', [newEmail, userId]);
      await opLog(operatorId, 'mailbox.updateAddress', `user:${userId}`, `${u.campus_email} -> ${newEmail}`, ip);
      return ok({ campusEmail: newEmail }, `校园邮箱已更新为 ${newEmail}`);
    }

    return fail(43200, `未知操作：${action}`);
  } catch (e) {
    return jsonError(e);
  }
}
