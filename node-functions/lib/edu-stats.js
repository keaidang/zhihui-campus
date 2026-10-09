// node-functions/lib/edu-stats.js — 学业统计口径（单一事实来源）
//
// 为什么单独抽出来：成绩等级、绩点、学分汇总这套口径原先写死在 api/edu/score.js 里，
// 而 C7 学业助手要用**完全相同**的口径回答"我还差多少学分""绩点多少"。
// 若各写一份，学生会在页面上看到 3.42、在 AI 那里听到 3.38 —— 同一个系统给出两个答案
// 是最伤信任的缺陷。所以口径只此一处，两边都 import。

/** 当前学期（全项目唯一硬编码点；换学期只改这里） */
export const CURRENT_TERM = '2026-2027-1';

/** 学期显示名（2026-2027-1 → 2026-2027 学年第一学期） */
export function termLabel(term) {
  const m = /^(\d{4})-(\d{4})-([12])$/.exec(String(term || ''));
  if (!m) return String(term || '');
  return `${m[1]}-${m[2]} 学年${m[3] === '1' ? '第一' : '第二'}学期`;
}

/** 百分制 → 等级（与成绩单展示一致） */
export function gradeOf(score) {
  if (score >= 90) return '优秀';
  if (score >= 80) return '良好';
  if (score >= 70) return '中等';
  if (score >= 60) return '及格';
  return '不及格';
}

/**
 * 百分制 → 绩点（4.0 制）
 * ★ 不及格的课**不计入绩点分母**（学分也不计），这是本校口径，别按"全部课程平均"算
 */
export function gpaPoint(score) {
  const s = Number(score);
  if (!Number.isFinite(s) || s < 60) return 0;
  if (s >= 90) return 4.0;
  if (s >= 80) return 3.0;
  if (s >= 70) return 2.0;
  return 1.0;
}

/**
 * 汇总学业情况（输入是 edu_elect JOIN 课表/课程的原始行）
 *
 * 传入行的约定（与 api/edu/score.js 的查询一致）：
 *   { score, grade, status, credit, course_name, course_code, term, week_day, section, classroom, teacher_name }
 *   status: 1 在修（无成绩） / 2 已出成绩
 *
 * @returns {{
 *   gradedCount:number, creditsEarned:number, creditsAttempted:number, gpa:number,
 *   failed:object[], graded:object[], inProgress:object[], byTerm:object[]
 * }}
 */
export function summarizeStudies(rows = []) {
  const graded = rows.filter((r) => Number(r.status) === 2 && r.score !== null && r.score !== undefined);
  const inProgress = rows.filter((r) => Number(r.status) === 1);

  const creditOf = (r) => Number(r.credit) || 0;
  const creditsAttempted = graded.reduce((s, r) => s + creditOf(r), 0);
  const passed = graded.filter((r) => Number(r.score) >= 60);
  const creditsEarned = passed.reduce((s, r) => s + creditOf(r), 0);
  // 绩点 = Σ(绩点×学分) / Σ(及格课学分)；分母为 0 时给 0（而不是 NaN —— 见铁律 #40 的教训）
  const gpaBase = passed.reduce((s, r) => s + gpaPoint(r.score) * creditOf(r), 0);
  const gpa = creditsEarned > 0 ? Math.round((gpaBase / creditsEarned) * 100) / 100 : 0;

  const failed = graded
    .filter((r) => Number(r.score) < 60)
    .map((r) => ({ courseCode: r.course_code, courseName: r.course_name, credit: creditOf(r), score: Number(r.score), term: r.term }));

  // 按学期分组（"哪学期学分拿得少"这类问题要能答）
  const termMap = new Map();
  for (const r of graded) {
    const t = String(r.term || '未知学期');
    if (!termMap.has(t)) termMap.set(t, { term: t, label: termLabel(t), courses: 0, credits: 0, failed: 0 });
    const g = termMap.get(t);
    g.courses += 1;
    if (Number(r.score) >= 60) g.credits += creditOf(r);
    else g.failed += 1;
  }

  return {
    gradedCount: graded.length,
    creditsEarned: Math.round(creditsEarned * 10) / 10,
    creditsAttempted: Math.round(creditsAttempted * 10) / 10,
    gpa,
    failed,
    graded,
    inProgress,
    byTerm: [...termMap.values()].sort((a, b) => b.term.localeCompare(a.term)),
  };
}
