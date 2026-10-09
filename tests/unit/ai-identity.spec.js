// AI 身份注入单测（node-functions/lib/ai-identity.js）
//
// 为什么值得测：身份块决定 AI"把谁当谁"。2026-10-09 线上真实缺陷就是
// 身份没注入 → 管理员被当学生、问"查看待审批"得到"如果你是学生…"的糊弄回答。
// 这类错误不会报错、只会让人觉得"AI 很蠢"，必须靠断言锁住。
import { describe, it, expect } from 'vitest';
import {
  ROLE_LABEL,
  ROLE_PRIORITY,
  ROLE_SCOPE,
  identityBlock,
  primaryRoleOf,
} from '../../node-functions/lib/ai-identity.js';

describe('ROLE_LABEL / ROLE_SCOPE · 覆盖率', () => {
  it('五类角色都有中文名（缺一个就会在提示词里露出 role code）', () => {
    for (const r of ['admin', 'leader', 'counselor', 'teacher', 'student']) {
      expect(ROLE_LABEL[r], r).toBeTruthy();
      expect(ROLE_SCOPE[r], r).toBeTruthy();
    }
  });

  it('★ 角色边界的关键约束必须写清楚（说错了比不说更糟）', () => {
    expect(ROLE_SCOPE.admin).toContain('全校');
    expect(ROLE_SCOPE.leader).toContain('只读'); // 校领导不能有写操作
    expect(ROLE_SCOPE.counselor).toContain('本院'); // 辅导员数据范围
    expect(ROLE_SCOPE.student).toContain('本人');
  });
});

describe('primaryRoleOf · 多角色取最高（★ 线上踩过）', () => {
  it('admin 演示账号同时有 admin 与 student → 取 admin（顺序无关）', () => {
    expect(primaryRoleOf(['admin', 'student'])).toBe('admin');
    expect(primaryRoleOf(['student', 'admin'])).toBe('admin');
  });

  it('优先级与前端 stores/auth.js 的 primaryRole 同序', () => {
    expect(ROLE_PRIORITY).toEqual(['admin', 'leader', 'counselor', 'teacher', 'student']);
    expect(primaryRoleOf(['student', 'teacher'])).toBe('teacher');
    expect(primaryRoleOf(['teacher', 'leader'])).toBe('leader');
    expect(primaryRoleOf(['leader', 'counselor'])).toBe('leader');
  });

  it('无角色 / 未知角色返回空串（不假装是学生）', () => {
    expect(primaryRoleOf([])).toBe('');
    expect(primaryRoleOf(['ghost'])).toBe('');
  });
});

describe('identityBlock · 身份块组装', () => {
  const id = { userId: 2000001, username: 'admin', realName: '刘维', deptName: '校长室' };

  it('包含姓名/账号/角色/部门', () => {
    const b = identityBlock(id, ['admin', 'student']);
    expect(b).toContain('刘维');
    expect(b).toContain('admin');
    expect(b).toContain('校长室');
    expect(b).toContain('超级管理员（admin）');
    expect(b).toContain('学生（student）');
  });

  it('★ 非学生用户被称为"老师"，且明确禁止叫"同学"', () => {
    const b = identityBlock(id, ['admin']);
    expect(b).toContain('称呼对方为「老师」');
    expect(b).toContain('把非学生用户称为"同学"');
    expect(b).toContain('也不要假设对方是学生');
  });

  it('学生被称为"同学"，且不出现"不要称同学"这种自相矛盾的指令', () => {
    const b = identityBlock({ realName: '张三' }, ['student']);
    expect(b).toContain('称呼「同学」');
    expect(b).not.toContain('把非学生用户称为"同学"');
  });

  it('辅导员 / 教师 / 校领导都按"老师"称呼（只有学生是"同学"）', () => {
    for (const r of ['counselor', 'teacher', 'leader']) {
      expect(identityBlock({ realName: 'X' }, [r]), r).toContain('称呼对方为「老师」');
    }
  });

  it('★ 明确禁止"如果你是学生…如果你是辅导员…"并列假设式回答', () => {
    const b = identityBlock(id, ['admin']);
    expect(b).toContain('如果你是学生');
    expect(b).toContain('严禁');
  });

  it('多角色时按"主角色"取数据范围（写操作按最高角色算）', () => {
    const b = identityBlock(id, ['admin', 'student']);
    expect(b).toContain(ROLE_SCOPE.admin);
    expect(b).not.toContain(ROLE_SCOPE.student);
  });

  it('★ 多角色账号显式声明"以最高角色为准"，避免模型把管理员当学生', () => {
    const b = identityBlock(id, ['admin', 'student']);
    expect(b).toContain('★ 这是多角色账号');
    expect(b).toContain('以超级管理员为准');
    expect(b).toContain('不得');
    expect(b).toContain('权限更小的角色');
  });

  it('单角色时不出现多角色声明（避免提示词噪音）', () => {
    expect(identityBlock(id, ['student'])).not.toContain('★ 这是多角色账号');
  });

  it('身份读不到时不编造，退化为"未知"且要求按最保守处理', () => {
    const b = identityBlock(null, []);
    expect(b).toContain('角色：未知');
    expect(b).toContain('最保守');
    expect(b).not.toContain('刘维');
  });

  it('缺部门/姓名时不出现 null / undefined 字样（会污染提示词）', () => {
    const b = identityBlock({ userId: 1, username: 'u1', realName: '', deptName: '' }, ['student']);
    expect(b).not.toContain('null');
    expect(b).not.toContain('undefined');
  });

  it('身份块本身声明了"必须据此调整"（防止模型忽略它）', () => {
    expect(identityBlock(id, ['admin'])).toContain('必须据此调整称呼与能力判断');
  });
});
