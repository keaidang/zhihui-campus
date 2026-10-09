// node-functions/lib/alert.js — 异常告警邮件通道（C3）
//
// 设计要点：
//   · 总开关 ai.alert.enabled（默认关），收件人 ai.alert.emails 留空时回退到
//     「admin 角色用户的校园邮箱」——不依赖某个人工维护的常量
//   · **去重**：同类告警在 ai.alert.dedupe_min 窗口内只发一封（防告警风暴刷爆额度）
//   · **绝不抛出**：所有异常吞掉只打日志，调用方 fire-and-forget，不能因为告警失败
//     而影响主业务（例如不能因为邮件发不出去就让 500 响应挂住）
//   · 发送结果与去重依据落 ai_alert_log
import { query } from './db.js';
import { getBool, getConfig, getInt } from './ai-config.js';
import { sendMail, lanqinConfigured } from './lanqin.js';

const TYPE_LABEL = {
  content_violation: '内容违规',
  system_500: '系统异常',
  ai_failure: 'AI 服务异常',
  login_bruteforce: '疑似撞库',
  data_anomaly: '数据异常',
  other: '系统提醒',
};

/** 收件人：显式配置优先，否则取 admin 角色用户的校园邮箱（去重、剔除空值） */
export async function resolveRecipients() {
  const explicit = String(await getConfig('ai.alert.emails', ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;
  const rows = await query(
    `SELECT u.campus_email AS email
       FROM sys_user_role ur
       JOIN sys_role r ON r.id = ur.role_id
       JOIN sys_user u ON u.id = ur.user_id
      WHERE r.code = 'admin' AND u.status = 1
        AND u.campus_email IS NOT NULL AND u.campus_email <> ''`,
  );
  return [...new Set(rows.map((r) => r.email))];
}

/**
 * HTML 转义（告警邮件用）
 *
 * ★ 为什么必须有（2026-10-10 体检发现）：`contentViolation` 的 detail 里含**用户可控**
 *   内容（帖子标题与正文摘要、模型基于用户内容生成的理由）。不转义就等于让发帖人
 *   往发给全体管理员的邮件里注入 HTML —— 可放钓鱼链接、追踪图片、伪造排版。
 *   邮件正文只有我们自己知道的结构才允许是 HTML，外部数据一律先转义。
 */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(type, title, detail) {
  const label = TYPE_LABEL[type] || TYPE_LABEL.other;
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
  // ★ 三个插值点全部转义后再拼进 HTML（label 来自内部映射表，也一并转义以防将来被改）
  return `<div style="max-width:600px;margin:0 auto;font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#1e293b">
  <div style="background:#17325c;border-radius:12px 12px 0 0;padding:16px 22px;color:#fff;font-size:15px;letter-spacing:1px">智汇校园 · ${escapeHtml(label)}告警</div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:22px">
    <p style="margin:0 0 10px;font-size:15px;font-weight:600">${escapeHtml(title)}</p>
    <div style="font-size:13px;line-height:1.8;color:#475569;white-space:pre-wrap;background:#f7f9fc;border-radius:8px;padding:12px">${escapeHtml(detail)}</div>
    <p style="margin:14px 0 0;font-size:12px;color:#94a3b8">触发时间（北京时间）：${escapeHtml(now)}<br/>本邮件由智汇校园系统自动发送，请勿直接回复。</p>
  </div>
</div>`;
}

/**
 * 发送告警（带去重）。返回 { sent, reason }，**永不抛异常**。
 * @param {{type:string, title:string, detail?:string, dedupeKey?:string, force?:boolean}} o
 */
export async function alertAdmins({ type = 'other', title, detail = '', dedupeKey = '', force = false }) {
  try {
    if (!force && !(await getBool('ai.alert.enabled', false))) return { sent: false, reason: 'disabled' };
    if (!lanqinConfigured()) return { sent: false, reason: 'mail-not-configured' };

    const key = String(dedupeKey || `${type}:${title}`).slice(0, 128);
    const winMin = Math.max(0, await getInt('ai.alert.dedupe_min', 30));
    if (!force && winMin > 0) {
      const [dup] = await query(
        'SELECT COUNT(*) AS n FROM ai_alert_log WHERE dedupe_key = ? AND ok = 1 AND created_at > NOW() - INTERVAL ? MINUTE',
        [key, winMin],
      );
      if (Number(dup?.n || 0) > 0) return { sent: false, reason: 'deduped' };
    }

    const to = await resolveRecipients();
    if (!to.length) {
      await logAlert(type, key, title, detail, '', 0, '无可用收件人');
      return { sent: false, reason: 'no-recipient' };
    }

    const label = TYPE_LABEL[type] || TYPE_LABEL.other;
    const r = await sendMail({
      to,
      subject: `【智汇校园·${label}】${String(title).slice(0, 80)}`,
      html: buildHtml(type, title, detail),
      text: `【智汇校园·${label}】${title}\n\n${detail}`,
    });
    await logAlert(type, key, title, detail, to.join(','), r.ok ? 1 : 0, r.error || '');
    return { sent: Boolean(r.ok), reason: r.ok ? 'ok' : r.error };
  } catch (e) {
    console.error('[alert-fail]', e?.message);
    return { sent: false, reason: 'exception' };
  }
}

async function logAlert(type, dedupeKey, title, detail, sentTo, ok, err) {
  try {
    await query(
      `INSERT INTO ai_alert_log (type, dedupe_key, title, detail, sent_to, ok, err) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(type).slice(0, 32),
        dedupeKey,
        String(title).slice(0, 255),
        String(detail).slice(0, 1024),
        String(sentTo).slice(0, 512),
        ok ? 1 : 0,
        String(err || '').slice(0, 255),
      ],
    );
  } catch (e) {
    console.error('[alert-log-fail]', e?.message);
  }
}

/** 语义化快捷方法（调用点用这些，避免各写各的文案） */
export const alert = {
  contentViolation: (o) => alertAdmins({ type: 'content_violation', ...o }),
  system500: (o) => alertAdmins({ type: 'system_500', ...o }),
  aiFailure: (o) => alertAdmins({ type: 'ai_failure', ...o }),
  loginBruteforce: (o) => alertAdmins({ type: 'login_bruteforce', ...o }),
  dataAnomaly: (o) => alertAdmins({ type: 'data_anomaly', ...o }),
};
