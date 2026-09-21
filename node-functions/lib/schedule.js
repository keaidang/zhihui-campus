// node-functions/lib/schedule.js — 节次解析与时段冲突判定（纯函数，便于单测）
//
// 为什么单独成文件：这段逻辑原先内联在 api/edu/course.js 的选课事务闭包里，
// 既无法单测，又是"改一处影响所有学生选课结果"的高风险判定。
// 抽成纯函数后由 tests/unit/schedule.spec.js 覆盖边界（相邻不冲突、跨越重叠、
// 非标准节次退化为字符串比较）。

/**
 * '第1-2节' / '1-2节' / '1-2' → [1, 2]
 * 非标准写法（如 '上午'、'第1节'）返回 null，调用方退化为字符串相等比较
 */
export function parseSection(s) {
  const m = /^(\d+)\s*-\s*(\d+)节?$/.exec(String(s || '').trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * 两个「星期 + 节次」是否冲突。
 * - 星期不同 → 不冲突
 * - 双方节次都是标准区间 → 区间重叠即冲突（含边界相接：1-2 与 2-3 视为冲突）
 * - 任一非标准 → 退化为去空格后字符串完全相同才冲突
 */
export function isScheduleConflict(weekDayA, sectionA, weekDayB, sectionB) {
  if (Number(weekDayA) !== Number(weekDayB)) return false;
  const a = parseSection(sectionA);
  const b = parseSection(sectionB);
  if (a && b) return a[0] <= b[1] && b[0] <= a[1]; // 区间重叠
  return String(sectionA ?? '').trim() === String(sectionB ?? '').trim();
}
