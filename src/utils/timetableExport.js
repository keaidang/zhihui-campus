// 周课表导出：页面内浮层预览（iframe 渲染）+ 一键打印（可另存 PDF）
// 与市面教务系统一致：不论课程多少，始终渲染完整网格 ——
//   列 = 周一~周日（固定 7 天），行 = 全部节次（1-2节 ~ 11-12节 固定 + 非标准节次追加），无课显示空格。
// list 元素: { week_day(1~7), section('1-2节' 等字符串), course_name, course_code, classroom, teacher_name? }
const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 固定节次行（与数据库 section 字段格式一致：'1-2节'）
const FIXED_PERIODS = ['1-2节', '3-4节', '5-6节', '7-8节', '9-10节', '11-12节'];
const PERIOD_HINT = {
  '1-2节': '08:00-09:40', '3-4节': '10:00-11:40', '5-6节': '14:00-15:40',
  '7-8节': '16:00-17:40', '9-10节': '19:00-20:40', '11-12节': '21:00-22:40',
};

// 柔和课程色板（低饱和学术风，打印友好）
const PALETTE = [
  ['#e8f0fb', '#2d5a9e'], ['#e6f4f1', '#0d7a6c'], ['#fdf1e2', '#b97324'],
  ['#efeafa', '#6b46c1'], ['#fbe9e9', '#b83232'], ['#e6f3f6', '#0e7490'],
  ['#f0f0e6', '#6b7224'], ['#f6e9f0', '#a13872'],
];
const colorOf = (code) => PALETTE[(String(code).charCodeAt(0) + String(code).length) % PALETTE.length];

/** 节次规范化：兼容 '1-2节' / '3-4' / 数字 1（按连续两节处理）/ '晚1' 等非标准格式 */
function normalizeSection(s) {
  const raw = String(s ?? '').trim();
  if (!raw) return '';
  if (FIXED_PERIODS.includes(raw)) return raw;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return FIXED_PERIODS.find((p) => p.startsWith(`${n}`)) || `${n}-${n + 1}节`;
  }
  if (/^\d+-\d+$/.test(raw)) return `${raw}节`;
  return raw; // 非标准节次原样保留，追加为额外行
}

/** 生成完整课表 HTML（固定全网格，无课空格） */
export function buildTimetableHtml({ title, subtitle, term, list = [] }) {
  // 行集合 = 固定节次 + 数据中出现的非标准节次
  const extra = [];
  for (const c of list) {
    const n = normalizeSection(c.section);
    if (n && !FIXED_PERIODS.includes(n) && !extra.includes(n)) extra.push(n);
  }
  const periods = [...FIXED_PERIODS, ...extra];

  const cell = (day, period) =>
    list
      .filter((c) => Number(c.week_day) === day && normalizeSection(c.section) === period)
      .map((c) => {
        const [bg, fg] = colorOf(c.course_code);
        return `<div class="course" style="background:${bg};border-color:${fg}33">
          <b style="color:${fg}">${esc(c.course_name)}</b>
          <span>${esc(c.classroom || '')}</span>
          ${c.teacher_name ? `<span>${esc(c.teacher_name)}</span>` : ''}
        </div>`;
      })
      .join('');

  const rows = periods
    .map(
      (p) => `<tr>
        <th class="sec"><span class="sec-name">${esc(p)}</span><span class="sec-hint">${esc(PERIOD_HINT[p] || '')}</span></th>
        ${[1, 2, 3, 4, 5, 6, 7].map((d) => `<td>${cell(d, p)}</td>`).join('')}
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1e293b; padding: 28px 32px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 3px solid #17325c; padding-bottom: 12px; margin-bottom: 18px; }
  .head h1 { font-size: 22px; color: #17325c; letter-spacing: 2px; }
  .head .who { font-size: 14px; color: #475569; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #cbd5e1; text-align: center; vertical-align: top; padding: 6px 4px; height: 68px; }
  thead th { background: #17325c; color: #fff; font-size: 14px; letter-spacing: 2px; padding: 10px 4px; }
  th.sec { background: #f0f4f9; color: #17325c; width: 86px; font-weight: 600; padding: 4px; }
  .sec-name { display: block; font-size: 13px; }
  .sec-hint { display: block; font-size: 10px; color: #94a3b8; font-weight: 400; margin-top: 2px; }
  .course { border-radius: 6px; border: 1px solid; padding: 5px 4px; font-size: 12px; line-height: 1.5; }
  .course b { display: block; font-size: 12.5px; }
  .course span { display: block; color: #64748b; font-size: 11px; }
  .foot { margin-top: 14px; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
  @media print { @page { size: A4 landscape; margin: 10mm; } body { padding: 0; } }
</style></head><body>
  <div class="head">
    <h1>${esc(title)}</h1>
    <div class="who">${esc(subtitle || '')}</div>
  </div>
  <table>
    <thead><tr><th class="sec">节次</th>${DAY_NAMES.slice(1).map((d) => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot"><span>学期：${esc(term || '')}</span><span>清北大学 · 智汇校园</span></div>
</body></html>`;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/**
 * 导出课表：页面内浮层预览（不被弹窗拦截），浮层内提供「打印 / 关闭」。
 * 始终渲染完整网格（周一~周日 × 全部节次），无课格为空。
 * @returns {boolean} list 为空时返回 false
 */
export function exportTimetable({ title, subtitle, term, list = [] }) {
  if (!Array.isArray(list) || !list.length) return false;

  // 移除旧浮层（防重复打开）
  const old = document.getElementById('zc-timetable-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'zc-timetable-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,0.62);display:flex;align-items:center;justify-content:center;padding:24px;';

  const panel = document.createElement('div');
  panel.style.cssText =
    'background:#fff;border-radius:14px;width:min(1080px,94vw);height:min(760px,92vh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.35);';

  const bar = document.createElement('div');
  bar.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc;';
  bar.innerHTML = `<span style="font-size:14px;font-weight:600;color:#17325c">课表预览 · ${esc(title)}</span>`;

  const btnPrint = document.createElement('button');
  btnPrint.textContent = '打印 / 另存 PDF';
  btnPrint.style.cssText =
    'background:#17325c;color:#fff;border:none;border-radius:8px;padding:7px 16px;font-size:13px;cursor:pointer;margin-right:10px;';
  const btnClose = document.createElement('button');
  btnClose.textContent = '关闭';
  btnClose.style.cssText =
    'background:#e2e8f0;color:#334155;border:none;border-radius:8px;padding:7px 16px;font-size:13px;cursor:pointer;';

  const btnBox = document.createElement('div');
  btnBox.style.cssText = 'display:flex;align-items:center;';
  btnBox.appendChild(btnPrint);
  btnBox.appendChild(btnClose);
  bar.appendChild(btnBox);

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'flex:1;border:none;width:100%;';
  iframe.setAttribute('title', 'timetable-preview');

  panel.appendChild(bar);
  panel.appendChild(iframe);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  btnClose.addEventListener('click', close);

  iframe.srcdoc = buildTimetableHtml({ title, subtitle, term, list });
  btnPrint.addEventListener('click', () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      // 兜底：新窗口打印
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(buildTimetableHtml({ title, subtitle, term, list }));
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 300);
      }
    }
  });

  return true;
}
