// 周课表导出：生成精美的 HTML 课程表格子并唤起打印（可另存为 PDF）
// list 元素: { week_day(1~7), section(1~N), course_name, course_code, classroom, teacher_name? }
const DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 柔和课程色板（低饱和学术风，打印友好）
const PALETTE = [
  ['#e8f0fb', '#2d5a9e'], ['#e6f4f1', '#0d7a6c'], ['#fdf1e2', '#b97324'],
  ['#efeafa', '#6b46c1'], ['#fbe9e9', '#b83232'], ['#e6f3f6', '#0e7490'],
  ['#f0f0e6', '#6b7224'], ['#f6e9f0', '#a13872'],
];
const colorOf = (code) => PALETTE[(String(code).charCodeAt(0) + String(code).length) % PALETTE.length];

export function exportTimetable({ title, subtitle, term, list = [] }) {
  if (!list.length) return false;
  const days = [...new Set(list.map((c) => Number(c.week_day)))].sort((a, b) => a - b);
  const sections = [...new Set(list.map((c) => Number(c.section)))].sort((a, b) => a - b);
  const cell = (day, section) =>
    list
      .filter((c) => Number(c.week_day) === day && Number(c.section) === section)
      .map((c) => {
        const [bg, fg] = colorOf(c.course_code);
        return `<div class="course" style="background:${bg};border-color:${fg}33">
          <b style="color:${fg}">${esc(c.course_name)}</b>
          <span>${esc(c.classroom || '')}</span>
          ${c.teacher_name ? `<span>${esc(c.teacher_name)}</span>` : ''}
        </div>`;
      })
      .join('');

  const rows = sections
    .map(
      (s) => `<tr><th class="sec">第${s}节</th>${days
        .map((d) => `<td>${cell(d, s)}</td>`)
        .join('')}</tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1e293b; padding: 28px 32px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 3px solid #17325c; padding-bottom: 12px; margin-bottom: 18px; }
  .head h1 { font-size: 22px; color: #17325c; letter-spacing: 2px; }
  .head .who { font-size: 14px; color: #475569; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #cbd5e1; text-align: center; vertical-align: top; padding: 6px 4px; min-height: 64px; height: 68px; }
  thead th { background: #17325c; color: #fff; font-size: 14px; letter-spacing: 2px; padding: 10px 4px; }
  th.sec { background: #f0f4f9; color: #17325c; width: 72px; font-weight: 600; }
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
    <thead><tr><th class="sec">节次</th>${days.map((d) => `<th>${DAY_NAMES[d]}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot"><span>学期：${esc(term || '')}</span><span>清北大学 · 智汇校园</span></div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
  return true;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
