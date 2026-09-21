// 时间口径单测 —— 全站最容易犯、代价最大的一类 bug（曾整体偏 8 小时）
//
// 被测语义（见 src/utils/time.js 顶部注释）：
//   库内 DATETIME = UTC 墙钟；展示 = 浏览器本地时区（目标 UTC+8）
//   「无时区标记的串」必须当 UTC 解析（补 Z），否则会按本地解析 → 早 8 小时
//
// 时区策略（不依赖执行机时区）：
//   ① 语义断言：与独立参考实现比对 —— 任何非 UTC 时区都能抓出"没补 Z"
//   ② 强断言：仅当本机为 UTC+8 时执行，验证具体显示值（项目真实运行环境）
import { describe, it, expect } from 'vitest';
import { fmtTime, fmtAgo } from '../../src/utils/time.js';

/** 独立参考实现：把「无时区标记的库内墙钟」当 UTC 解析，再按本地时区展示 */
function localOfUtcWallClock(s) {
  const d = new Date(`${String(s).replace(' ', 'T')}Z`);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const isUtc8 = new Date().getTimezoneOffset() === -480;

describe('fmtTime · 空值与非法输入', () => {
  it('null / undefined / 空串 → 默认占位符', () => {
    expect(fmtTime(null)).toBe('—');
    expect(fmtTime(undefined)).toBe('—');
    expect(fmtTime('')).toBe('—');
  });

  it('占位符可自定义（empty 选项）', () => {
    expect(fmtTime(null, { empty: '' })).toBe('');
    expect(fmtTime('', { empty: '未知' })).toBe('未知');
  });

  it('无法解析的串原样返回（便于界面暴露脏数据）', () => {
    expect(fmtTime('not-a-date')).toBe('not-a-date');
  });
});

describe('fmtTime · 核心语义：库内 UTC 墙钟按 UTC 解析', () => {
  it('无时区标记的串 → 与「补 Z 后的同一瞬时」显示一致', () => {
    // 若实现漏了补 Z（按本地解析），在非 UTC 时区下本断言会失败 —— 这正是 8 小时偏差
    expect(fmtTime('2026-09-20 14:13:22')).toBe(localOfUtcWallClock('2026-09-20 14:13:22'));
    expect(fmtTime('2026-09-20')).toBe(localOfUtcWallClock('2026-09-20'));
  });

  it('无时区墙钟 与 显式 Z 的 ISO 串 必须等价（同一瞬时）', () => {
    expect(fmtTime('2026-09-20 14:13:22')).toBe(fmtTime('2026-09-20T14:13:22Z'));
    expect(fmtTime('2026-09-20 14:13:22')).toBe(fmtTime('2026-09-20T14:13:22.000Z'));
  });

  it('已带时区偏移的串不得再补 Z', () => {
    // '+08:00' 的真实瞬时 = 06:13:22Z；错误地当成 UTC 会得到 8 小时后的时间
    expect(fmtTime('2026-09-20T14:13:22+08:00')).toBe(fmtTime('2026-09-20T06:13:22Z'));
  });

  it('Date 对象与时间戳按本地时区直接展示（不再做任何换算）', () => {
    const d = new Date(2026, 8, 20, 14, 13, 22); // 本地时间 2026-09-20 14:13:22
    expect(fmtTime(d)).toBe('2026-09-20 14:13');
    expect(fmtTime(d.getTime())).toBe('2026-09-20 14:13');
  });
});

describe.runIf(isUtc8)('fmtTime · 北京时区强断言（本机 UTC+8）', () => {
  it('库内 UTC 墙钟 14:13 应显示为北京时间 22:13', () => {
    expect(fmtTime('2026-09-20 14:13:22')).toBe('2026-09-20 22:13');
  });

  it('跨日边界：UTC 20:00 应显示为次日 04:00', () => {
    expect(fmtTime('2026-09-20 20:00:00')).toBe('2026-09-21 04:00');
  });

  it('日期串（仅日期）在北京时区不偏移日界', () => {
    // 2026-09-20T00:00:00Z → 北京 08:00 同日
    expect(fmtTime('2026-09-20', { dateOnly: true })).toBe('2026-09-20');
  });
});

describe('fmtTime · 输出选项', () => {
  it('默认 YYYY-MM-DD HH:mm，sec 带秒，short 省年份，dateOnly 仅日期', () => {
    const utc = '2026-09-20T14:13:22Z';
    expect(fmtTime(utc)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(fmtTime(utc, { sec: true })).toBe(`${fmtTime(utc)}:22`);
    expect(fmtTime(utc, { short: true })).toBe(fmtTime(utc).slice(5));
    expect(fmtTime(utc, { dateOnly: true })).toBe(fmtTime(utc).slice(0, 10));
  });
});

describe('fmtAgo · 相对时间', () => {
  const ago = (ms) => new Date(Date.now() - ms);

  it('1 分钟内 → 刚刚', () => {
    expect(fmtAgo(ago(5_000))).toBe('刚刚');
    expect(fmtAgo(ago(59_000))).toBe('刚刚');
  });

  it('1 小时内 → n 分钟前', () => {
    expect(fmtAgo(ago(60_000))).toBe('1 分钟前');
    expect(fmtAgo(ago(59 * 60_000))).toBe('59 分钟前');
  });

  it('24 小时内 → n 小时前', () => {
    expect(fmtAgo(ago(60 * 60_000))).toBe('1 小时前');
    expect(fmtAgo(ago(23 * 3600_000))).toBe('23 小时前');
  });

  it('超过 24 小时 → 回退成绝对时间', () => {
    const old = new Date(2026, 0, 2, 3, 4);
    expect(fmtAgo(old)).toBe(fmtTime(old));
  });

  it('空值 → 空串（列表里不留占位符）', () => {
    expect(fmtAgo(null)).toBe('');
    expect(fmtAgo('')).toBe('');
  });
});
