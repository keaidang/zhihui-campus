// node-functions/lib/notify.js — 站内信发送统一出口
// 业务方（审批/报修/管理员群发等）调用 notify* 写 sys_message；
// 失败不影响主业务（尽力而为），但错误在服务端可见。
import { query } from './db.js';

/** 给单个用户发一条站内消息
 *  @param {number} receiverId 接收人
 *  @param {string} title      标题（≤128）
 *  @param {string} content    正文（≤1024）
 *  @param {object} [opts]     { senderId=0 系统, type='system'|'user', biz='leave|club|repair|manual...' }
 */
export async function notify(receiverId, title, content, opts = {}) {
  try {
    if (!receiverId || !title) return;
    await query(
      'INSERT INTO sys_message (sender_id, receiver_id, type, biz, title, content) VALUES (?, ?, ?, ?, ?, ?)',
      [
        Number(opts.senderId) || 0,
        Number(receiverId),
        opts.type === 'user' ? 'user' : 'system',
        String(opts.biz || '').slice(0, 24),
        String(title).slice(0, 128),
        String(content || '').slice(0, 1024),
      ],
    );
  } catch (e) {
    console.error('[notify-fail]', receiverId, title, e?.message);
  }
}

/** 批量通知（去重、逐条尽力而为；广播量级校内 ≤ 数百行，可接受） */
export async function notifyMany(receiverIds, title, content, opts = {}) {
  const ids = [...new Set(receiverIds.map(Number).filter(Boolean))];
  for (const id of ids) await notify(id, title, content, opts);
}

/** 按角色广播：返回该角色全部启用用户 id */
export async function roleUserIds(roleCode) {
  const rows = await query(
    `SELECT ur.user_id AS id FROM sys_user_role ur
       JOIN sys_role r ON r.id = ur.role_id
       JOIN sys_user u ON u.id = ur.user_id
      WHERE r.code = ? AND u.status = 1`,
    [roleCode],
  );
  return rows.map((r) => r.id);
}

/** 全校广播（admin 用）：全部启用用户 id */
export async function allUserIds() {
  const rows = await query('SELECT id FROM sys_user WHERE status = 1');
  return rows.map((r) => r.id);
}
