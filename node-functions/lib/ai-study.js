// node-functions/lib/ai-study.js — C7 学生学业助手
//
// 定位（docs/AI-FEATURES.md §8.1）：基于**本人**成绩与选课数据，回答
//   「我还差多少学分」「哪些课挂了」「绩点多少」「下学期该选什么」。
//
// ★ 安全边界（本模块最要紧的一条）：所有 SQL 的 WHERE 都**硬编码 student_id = 当前登录用户**，
//   不接受任何来自请求的 studentId 参数。学生的成绩是隐私，越权查询在这里不是"权限判断漏了"，
//   而是"根本没有可越权的入口"——这是比加一层 if 更可靠的做法。
//
// ★ 事实优先：先把成绩/学分/课表算成**结构化事实**喂给模型，让它只做"基于事实的表述"，
//   不让它自己算 GPA、自己数挂科（模型算术不可靠，且算错了没法复核）。事实口径来自
//   lib/edu-stats.js，与成绩页面完全同源。
import { aiConfigured } from './ai.js';
import { getBool, getInt } from './ai-config.js';
import { query } from './db.js';
import { CURRENT_TERM, termLabel, summarizeStudies } from './edu-stats.js';
import { buildAnswerSystem } from './ai-prompt.js';
import { KB_PROFILE, buildKnowledgeContext } from './ai-kb.js';
import { identityBlock, loadIdentity } from './ai-identity.js';

/** 学业助手可回答的范围（界面与提示词共用，避免"我以为它能答"造成的落差） */
export const STUDY_TOPICS = [
  '我已修 / 还差多少学分',
  '哪些课不及格（挂科）',
  '我的平均绩点',
  '我这学期的课表',
  '选课建议（还有哪些课有余量）',
  '哪学期学分拿得少',
];

/**
 * 拉取本人学业原始数据
 * @param {number} userId 当前登录用户（**唯一来源**，绝不从请求体取）
 */
export async function loadStudyRows(userId) {
  return query(
    `SELECT e.term, e.status, e.score, e.grade,
            c.code AS course_code, c.name AS course_name, c.credit,
            x.week_day, x.section, x.classroom,
            t.real_name AS teacher_name
       FROM edu_elect e
       JOIN edu_class x ON x.id = e.class_id
       JOIN edu_course c ON c.id = x.course_id
       JOIN sys_user t ON t.id = x.teacher_id
      WHERE e.student_id = ? AND e.status IN (1, 2)
      ORDER BY e.term DESC, c.code`,
    [userId],
  );
}

/** 可选课程（有余量且本人未选），供"下学期该选什么"给出具体选项 */
export async function loadElectable(userId, limit = 30) {
  return query(
    `SELECT c.code AS course_code, c.name AS course_name, c.credit,
            x.week_day, x.section, x.classroom, x.capacity, x.enrolled,
            t.real_name AS teacher_name
       FROM edu_class x
       JOIN edu_course c ON c.id = x.course_id
       JOIN sys_user t ON t.id = x.teacher_id
      WHERE x.term = ? AND x.status = 1 AND x.enrolled < x.capacity
        AND x.id NOT IN (SELECT class_id FROM edu_elect WHERE student_id = ? AND status IN (1, 2))
      ORDER BY c.code
      LIMIT ?`,
    [CURRENT_TERM, userId, limit],
  );
}

const WD = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 学业概览（前端"我的学业档案"卡片；不耗 AI token） */
export function buildOverview(rows) {
  const s = summarizeStudies(rows);
  const schedule = s.inProgress
    .slice()
    .sort((a, b) => Number(a.week_day) - Number(b.week_day) || String(a.section).localeCompare(String(b.section)))
    .map((r) => ({
      course: r.course_name,
      when: `${WD[Number(r.week_day)] || ''} ${r.section}`,
      where: r.classroom || '',
      teacher: r.teacher_name || '',
    }));
  return {
    term: CURRENT_TERM,
    termLabel: termLabel(CURRENT_TERM),
    creditsEarned: s.creditsEarned,
    creditsAttempted: s.creditsAttempted,
    gpa: s.gpa,
    gradedCount: s.gradedCount,
    failedCount: s.failed.length,
    failed: s.failed.slice(0, 10),
    inProgressCount: s.inProgress.length,
    schedule,
    byTerm: s.byTerm,
  };
}

/**
 * 组装"学业事实"文本（模型只读这个，不自己算）
 * 事实拼装的两条纪律（铁律 #41）：
 *   ① 取不到/算不出的项显式写「（无数据）」，不留空、不给默认值
 *   ② 数字一律由服务端算好带单位，模型只负责用自然语言复述
 */
export function buildStudyFacts(rows, electable = []) {
  const s = summarizeStudies(rows);
  const lines = [];

  lines.push(`【学业事实】（由系统按学生本人数据计算，请直接引用，不要自行重算）`);
  lines.push(`- 当前学期：${termLabel(CURRENT_TERM)}（${CURRENT_TERM}）`);
  lines.push(
    `- 已出成绩课程 ${s.gradedCount} 门；已获学分 ${s.creditsEarned}；参与计算学分（含不及格）${s.creditsAttempted}；平均绩点 ${s.gpa}（4.0 制，不及格课程不计入）`,
  );

  if (s.byTerm.length) {
    lines.push('- 分学期：');
    for (const t of s.byTerm) lines.push(`    ${t.label}：${t.courses} 门、获 ${t.credits} 学分、不及格 ${t.failed} 门`);
  } else {
    lines.push('- 分学期：（无数据）');
  }

  if (s.failed.length) {
    lines.push(`- 不及格课程 ${s.failed.length} 门（**这些课的学分未获得**）：`);
    for (const f of s.failed) lines.push(`    ${f.courseName}（${f.courseCode}，${f.credit} 学分，${f.score} 分，${termLabel(f.term)}）`);
  } else {
    lines.push('- 不及格课程：无');
  }

  if (s.inProgress.length) {
    lines.push(`- 本学期在修 ${s.inProgress.length} 门（**尚无成绩**，不要把它们当成已修学分）：`);
    for (const r of s.inProgress) {
      lines.push(`    ${r.course_name}（${r.course_code}，${r.credit} 学分）${WD[Number(r.week_day)] || ''} ${r.section} ${r.classroom || ''} ${r.teacher_name || ''}`);
    }
  } else {
    lines.push('- 本学期在修课程：（无数据）');
  }

  if (electable.length) {
    lines.push(`- 可修且有余量的课程（前 ${electable.length} 门，可用于选课建议）：`);
    for (const e of electable) {
      lines.push(
        `    ${e.course_name}（${e.course_code}，${e.credit} 学分）${WD[Number(e.week_day)] || ''} ${e.section} 余 ${Math.max(0, Number(e.capacity) - Number(e.enrolled))} 位 ${e.teacher_name || ''}`,
      );
    }
  } else {
    lines.push('- 可修课程：（无数据）');
  }

  return lines.join('\n');
}

const STUDY_RULES = [
  '【学业助手专项纪律】',
  '1. 上面的【学业事实】是**唯一数据来源**。学分、绩点、挂科门数一律直接引用，不要自己加减乘除。',
  '2. 事实里写「（无数据）」的，就回答"这项数据我这边没有"，不要推测。',
  '3. 给选课建议时，**只能从"可修且有余量的课程"里挑**，并说明理由（学分缺口、与现有课表是否冲突、课程性质）。不要推荐事实里没有的课。',
  '4. 不评价老师的教学水平，不预测分数，不承诺"选这门一定过"。',
  '5. 发现学生可能挂科较多时，语气要鼓励但不说教，可以建议联系辅导员或教务。',
].join('\n');

/**
 * 组装完整的 system prompt（供 api/ai/study.js 使用）
 * @param {{userId:number, roles:string[]}} actor
 */
export async function buildStudySystem(actor, question) {
  const [identity, rows, electable, kb] = await Promise.all([
    loadIdentity(actor.userId),
    loadStudyRows(actor.userId),
    loadElectable(actor.userId),
    buildKnowledgeContext(question, {
      inlineMaxChars: await getInt('ai.kb.inline_max_chars', 4000),
      topK: await getInt('ai.kb.top_k', 5),
      minScore: 3,
      minRatio: 0.25,
    }),
  ]);

  return {
    system: buildAnswerSystem({
      identityText: identityBlock(identity, actor.roles),
      kbProfile: KB_PROFILE,
      kbText: kb.text,
      extraTop: [STUDY_RULES, '', buildStudyFacts(rows, electable)].join('\n'),
    }),
    overview: buildOverview(rows),
    sources: kb.sources || [],
  };
}

/** 是否开启（默认 1：学业助手是低风险只读能力，默认给学生用） */
export async function studyEnabled() {
  if (!aiConfigured()) return false;
  if (!(await getBool('ai.enabled', true))) return false;
  return getBool('ai.study.enabled', true);
}

/** 拼 messages：system(纪律 + 身份 + 档案 + 知识 + 学业事实) + 近几轮历史 + 本次提问 */
export function buildStudyMessages(system, question, history = []) {
  const messages = [{ role: 'system', content: system }];
  for (const h of history.slice(-6)) {
    const role = h?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(h?.content ?? '').trim().slice(0, 1000);
    if (content) messages.push({ role, content });
  }
  messages.push({ role: 'user', content: question });
  return messages;
}
