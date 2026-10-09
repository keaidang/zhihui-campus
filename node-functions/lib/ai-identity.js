// node-functions/lib/ai-identity.js — 把"提问者是谁"注入 AI 上下文
//
// 为什么需要（2026-10-09 线上实测暴露的真实缺陷）：
//   原 chat.js 的 system prompt 只有「回答纪律 + 平台档案 + 检索资料」，**完全没有提问者身份**。
//   模型因此默认把对方当学生（称呼"同学"、答"如果你是学生…如果你是辅导员…"），
//   管理员问"查看所有待审批的请假"得到的是含糊的角色科普，而不是针对 TA 角色的回答。
//
// 设计原则：
//   · 身份**只来自数据库**（requireRoles 已实时查库校验角色），绝不信前端传参
//   · 只注入**提问者自己**的身份，不注入任何他人数据（无越权面）
//   · 角色能力边界必须与 PortalShell 的 MENUS / WorkbenchView 的 BY_ROLE 保持一致
//     —— 这里描述的是"平台真实能做什么"，说错了比不说更糟
import { query } from './db.js';

/** 角色中文名（与前端 ROLE_LABEL 一致） */
export const ROLE_LABEL = {
  admin: '超级管理员',
  leader: '校领导',
  counselor: '辅导员',
  teacher: '教师',
  student: '学生',
};

/**
 * 各角色在**本平台**的真实能力边界与数据范围。
 * ⚠ 必须与前端菜单（PortalShell MENUS）与工作台矩阵（WorkbenchView BY_ROLE）同源核对；
 *   改权限时三处一起改，否则 AI 会说出系统做不到的事。
 */
export const ROLE_SCOPE = {
  admin:
    '全校全部模块的读写权限：账号与角色管理、学生管理、系部与班级、课程与排课、全校公告、请假审批、报修处理、宿舍管理、图书管理、论坛管理（置顶/锁定/禁言）、失物招领发布。数据范围=全校。另有数据驾驶舱（只读）。限制：不能禁用或删除自己的账号。',
  leader: '数据驾驶舱（全校只读）、全校公告浏览。数据范围=全校，但**只有只读权限，没有任何写操作**。',
  counselor:
    '本院学生名册、请假审批、报修处理、本院公告发布、失物招领发布。数据范围=**本院**（看不到别的学院的数据）。无账号管理、无课程排课、无全校公告。',
  teacher:
    '本人教学班的选课名单、本人课程的成绩录入、本院公告发布、社团申请审批。数据范围=**本人**（只看得到自己的教学班与本人相关数据）。',
  student:
    '课程选课与退课、成绩与课表、请销假、宿舍信息与报修、图书借阅、社团报名、校园论坛、失物招领浏览、校园邮箱（需管理员开通）。数据范围=**本人**（只看得到自己的数据）。',
};

/** 称呼：只有学生叫"同学"，其余都称"老师" */
function appellation(roles = []) {
  if (roles.includes('admin') || roles.includes('leader') || roles.includes('counselor') || roles.includes('teacher')) return '老师';
  return '同学';
}

/**
 * 读提问者身份（只读，仅本人）
 * @param {number} userId
 * @returns {Promise<{userId:number, username:string, realName:string, deptName:string}|null>}
 */
export async function loadIdentity(userId) {
  try {
    const rows = await query(
      `SELECT u.username, u.real_name, d.name AS dept_name
         FROM sys_user u
         LEFT JOIN sys_department d ON d.id = u.dept_id
        WHERE u.id = ?`,
      [Number(userId) || 0],
    );
    if (!rows.length) return null;
    return {
      userId: Number(userId),
      username: String(rows[0].username || ''),
      realName: String(rows[0].real_name || rows[0].username || ''),
      deptName: String(rows[0].dept_name || ''),
    };
  } catch {
    // 身份读不到不能拖垮问答：调用方按"身份未知"降级（不放宽任何判断）
    return null;
  }
}

/**
 * 组装身份块（纯函数，供单测）
 * @param {object|null} identity loadIdentity 的结果
 * @param {string[]} roles 实时查库得到的角色
 * @returns {string}
 */
export function identityBlock(identity, roles = []) {
  const roleLabels = roles.map((r) => `${ROLE_LABEL[r] || r}（${r}）`).join('、') || '未知';
  // ★ 不用 `|| 'student'` 兜底：拿不到角色时**不能假装是学生**（标签会说"未知"、
  //   范围却按学生算，前后矛盾），而应显式退化为最保守描述。
  const primary = roles[0] || '';
  const who = appellation(roles);
  const lines = [
    '【当前提问者身份】（必须据此调整称呼与能力判断）',
    identity?.realName ? `- 姓名：${identity.realName}` : null,
    identity?.username ? `- 账号：${identity.username}` : null,
    `- 角色：${roleLabels}`,
    identity?.deptName ? `- 所属部门/院系：${identity.deptName}` : null,
    `- 数据范围与可用功能：${ROLE_SCOPE[primary] || '未知，按最保守处理'}`,
    '',
    '【据此必须遵守的身份纪律】',
    `1. 称呼对方为「${who}」，**不要**把非学生用户称为"同学"，也不要假设对方是学生。`,
    '2. 回答前先判断：这件事是否在该角色的能力范围内。在范围内就直接给针对性的答案（直接说"你可以在…哪里…做什么"），不要绕。',
    '3. 若超出能力范围：直接说明"你是<角色>，无法<某操作>"，并指出**应当由谁做**；**严禁**输出"如果你是学生…如果你是辅导员…"这种并列假设式回答——系统已经知道 TA 是谁，猜身份就是不专业。',
    '4. 涉及数据时按其数据范围作答（学生/教师=本人，辅导员=本院，校领导/管理员=全校）。',
    '5. 不要向对方透露、也不要索取其他用户的个人信息。',
  ];
  return lines.filter((x) => x !== null).join('\n');
}
