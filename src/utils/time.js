// 全站统一时间展示工具
// ─────────────────────────────────────────────────────────────
// 时区口径（2026-09-20 实测确认，改动前务必读完）：
//   1. TiDB 会话时区 = UTC（@@system_time_zone='UTC'），所有 DATETIME 存的是 UTC 墙钟，
//      业务写库一律用 NOW() → 落库值即 UTC。
//   2. Node Functions 的 mysql2 连接 timezone 必须为 'Z'（见 lib/db.js），
//      这样后端 Date 对象/JSON 序列化出来的都是真实瞬时（ISO 带 Z）。
//   3. 展示层唯一入口是本文件的 fmtTime()：把真实瞬时转成浏览器本地时区（目标用户 UTC+8）。
//      ✗ 禁止再写 String(x).replace('T',' ').slice(0,16) —— 那个写法显示的是 UTC 墙钟，早 8 小时。
//      ✗ 禁止在前端对库内时间做 new Date() 后手工 ±8 小时。
export function fmtTime(v, opts = {}) {
  if (v === null || v === undefined || v === '') return opts.empty ?? '—';
  let d;
  if (v instanceof Date) {
    d = v;
  } else if (typeof v === 'number') {
    d = new Date(v);
  } else {
    const s = String(v).trim();
    // 形如 '2026-09-20 14:13:22' / '2026-09-20' 的库内 UTC 墙钟字符串（无时区标记）→ 补 Z 当 UTC 解析
    if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) {
      d = new Date(`${s.replace(' ', 'T')}Z`);
    } else {
      d = new Date(s);
    }
  }
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (opts.short) return `${date.slice(5)} ${hm}`;          // MM-DD HH:mm
  if (opts.dateOnly) return date;                            // YYYY-MM-DD
  if (opts.sec) return `${date} ${hm}:${p(d.getSeconds())}`; // YYYY-MM-DD HH:mm:ss
  return `${date} ${hm}`;                                    // YYYY-MM-DD HH:mm
}

/** 相对时间（论坛/消息列表用）：1分钟内=刚刚，1小时内=n分钟前，24小时内=n小时前，否则日期 */
export function fmtAgo(v) {
  if (!v) return '';
  const s = String(v).trim();
  const d = v instanceof Date
    ? v
    : /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)
      ? new Date(`${s.replace(' ', 'T')}Z`)
      : new Date(s);
  if (Number.isNaN(d.getTime())) return String(v);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return fmtTime(v);
}
