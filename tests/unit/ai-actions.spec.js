// C5 动作白名单与确认令牌单测（lib/ai-actions.js）
//
// 为什么值得测：这里是**唯一能让 AI 产生写操作**的地方，属于全项目权限最高危的代码。
//   一个注册表写歪（比如忘了 run、roles 写成 ['student']、kind 写成 'read'），
//   后果是越权执行或静默不执行，而且都不会在页面上报错。
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  ACTIONS,
  actionCatalog,
  actionPromptFor,
  canTrigger,
  executeConfirmedAction,
  previewWriteAction,
  runReadAction,
  signConfirmToken,
  verifyConfirmToken,
} from '../../node-functions/lib/ai-actions.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'unit-test-secret-key-long-enough-0123456789';
});

const admin = { userId: 2000001, roles: ['admin', 'student'], deptId: null, ip: '127.0.0.1' };
const counselor = { userId: 3000001, roles: ['counselor'], deptId: 3, ip: '127.0.0.1' };
const teacher = { userId: 4000001, roles: ['teacher'], deptId: 3, ip: '127.0.0.1' };
const leader = { userId: 5000001, roles: ['leader'], deptId: null, ip: '127.0.0.1' };
const student = { userId: 1000001, roles: ['student'], deptId: 3, ip: '127.0.0.1' };

describe('ACTIONS · 注册表自身的不变量', () => {
  it('★ 每个动作都必须有 label / desc / roles 且 roles 非空', () => {
    for (const [key, a] of Object.entries(ACTIONS)) {
      expect(a.label, `${key}.label`).toBeTruthy();
      expect(a.desc, `${key}.desc`).toBeTruthy();
      expect(Array.isArray(a.roles), `${key}.roles 必须是数组`).toBe(true);
      expect(a.roles.length, `${key}.roles 不能为空`).toBeGreaterThan(0);
      expect(['read', 'write'], `${key}.kind`).toContain(a.kind);
      expect(typeof a.run, `${key}.run 必须是函数`).toBe('function');
    }
  });

  it('★ 每个写操作都必须是 destructive 且带 resolve（没有 resolve 就无法预览）', () => {
    for (const [key, a] of Object.entries(ACTIONS)) {
      if (a.kind !== 'write') continue;
      expect(a.destructive, `${key} 写操作必须 destructive=true`).toBe(true);
      expect(typeof a.resolve, `${key}.resolve 必须是函数`).toBe('function');
    }
  });

  it('★ 学生不能触发任何写操作（这是本项目最基本的安全断言）', () => {
    const writes = actionCatalog(student).filter((a) => a.kind === 'write');
    expect(writes).toEqual([]);
  });

  it('校领导（只读角色）不能触发任何动作', () => {
    expect(actionCatalog(leader)).toEqual([]);
  });
});

describe('canTrigger / actionCatalog · 角色可见范围', () => {
  it('admin 能用账号管理、请假审批、公告、审核处置', () => {
    const keys = actionCatalog(admin).map((a) => a.key);
    expect(keys).toContain('disable_users');
    expect(keys).toContain('approve_leaves');
    expect(keys).toContain('publish_notice');
    expect(keys).toContain('confirm_violation');
  });

  it('counselor 能用本院账号与请假，但**不能**处置审核队列', () => {
    const keys = actionCatalog(counselor).map((a) => a.key);
    expect(keys).toContain('disable_users');
    expect(keys).toContain('approve_leaves');
    expect(keys).not.toContain('confirm_violation');
    expect(keys).not.toContain('pin_notice');
  });

  it('teacher 只能发/撤公告，不能碰账号与审批', () => {
    const keys = actionCatalog(teacher).map((a) => a.key);
    expect(keys).toContain('publish_notice');
    expect(keys).not.toContain('disable_users');
    expect(keys).not.toContain('approve_leaves');
  });

  it('canTrigger 对无 roles 的 actor 一律 false', () => {
    expect(canTrigger({}, ACTIONS.disable_users)).toBe(false);
    expect(canTrigger({ roles: [] }, ACTIONS.disable_users)).toBe(false);
  });
});

describe('actionPromptFor · 给模型的可用动作说明', () => {
  it('只列出该角色能用的动作（减少模型幻觉出无权动作）', () => {
    const p = actionPromptFor(teacher);
    expect(p).toContain('publish_notice');
    expect(p).not.toContain('disable_users');
  });

  it('无可用动作时给出明确说明而不是空串', () => {
    expect(actionPromptFor(student)).toContain('没有任何可执行的系统操作');
  });

  it('写操作在提示词里标明"需用户确认"（模型才会用"我先给你看一下"的口吻）', () => {
    expect(actionPromptFor(admin)).toContain('需用户确认');
  });
});

describe('确认令牌 · 签发与校验（两阶段确认的核心）', () => {
  it('往返：合法令牌能解出 action / params / targetIds', () => {
    const token = signConfirmToken({ userId: admin.userId, action: 'disable_users', params: { usernames: ['a'] }, targetIds: [1, 2] });
    const v = verifyConfirmToken(token, admin);
    expect(v.action).toBe('disable_users');
    expect(v.params).toEqual({ usernames: ['a'] });
    expect(v.targetIds).toEqual([1, 2]);
  });

  it('★ 令牌绑定操作者：另一个管理员拿到也用不了', () => {
    const token = signConfirmToken({ userId: admin.userId, action: 'disable_users', params: {}, targetIds: [1] });
    const other = { ...admin, userId: 9999999 };
    expect(() => verifyConfirmToken(token, other)).toThrowError(/不属于当前登录用户/);
  });

  it('★ 篡改过的令牌被拒', () => {
    const token = signConfirmToken({ userId: admin.userId, action: 'disable_users', params: {}, targetIds: [1] });
    expect(() => verifyConfirmToken(`${token}x`, admin)).toThrowError();
    expect(() => verifyConfirmToken('not-a-token', admin)).toThrowError(/无效或已过期/);
    expect(() => verifyConfirmToken('', admin)).toThrowError(/无效或已过期/);
  });

  it('★ 过期令牌被拒（5 分钟有效期）', () => {
    const expired = jwt.sign(
      { sub: String(admin.userId), act: 'disable_users', prm: {}, tgt: [1] },
      process.env.JWT_SECRET,
      { expiresIn: -10, algorithm: 'HS256', audience: 'ai-confirm' },
    );
    expect(() => verifyConfirmToken(expired, admin)).toThrowError(/无效或已过期/);
  });

  it('★ 换一个 audience 签的令牌（例如访问令牌）不算确认令牌', () => {
    const accessLike = jwt.sign({ sub: String(admin.userId), act: 'disable_users' }, process.env.JWT_SECRET, {
      expiresIn: 600,
      algorithm: 'HS256',
    });
    expect(() => verifyConfirmToken(accessLike, admin)).toThrowError();
  });

  it('★ 非 write 动作的令牌被拒（防止把只读动作伪装成写操作绕过确认）', () => {
    const token = jwt.sign(
      { sub: String(admin.userId), act: 'query_users', prm: {}, tgt: [] },
      process.env.JWT_SECRET,
      { expiresIn: 600, algorithm: 'HS256', audience: 'ai-confirm' },
    );
    expect(() => verifyConfirmToken(token, admin)).toThrowError(/白名单/);
  });

  it('★ 令牌里的角色已失效时拒绝执行（先降权再用旧令牌也不行）', () => {
    const token = signConfirmToken({ userId: counselor.userId, action: 'approve_leaves', params: {}, targetIds: [1] });
    const demoted = { ...counselor, roles: ['student'] };
    expect(() => verifyConfirmToken(token, demoted)).toThrowError(/无权执行/);
  });
});

describe('参数校验 · 批量操作必须显式给出范围', () => {
  it('★ 没有任何范围信息时拒绝预览（防"一句话把全校禁了"）', async () => {
    await expect(previewWriteAction(admin, 'disable_users', {})).rejects.toThrowError(/请说明要对哪些账号执行/);
  });

  it('★ 只说"全部"但没有任何限定（角色/关键字）时拒绝', async () => {
    await expect(previewWriteAction(admin, 'disable_users', { all: true })).rejects.toThrowError(/范围太大/);
  });

  it('★ 只读动作不能走预览通道（避免绕过"读直接执行"的分支）', async () => {
    await expect(previewWriteAction(admin, 'query_users', {})).rejects.toThrowError(/只读/);
  });

  it('★ 白名单外的 action key 一律拒绝', async () => {
    await expect(previewWriteAction(admin, 'drop_all_tables', {})).rejects.toThrowError(/无法识别/);
    await expect(runReadAction(admin, 'exec_sql', {})).rejects.toThrowError(/无法识别/);
  });

  it('★ 无权角色调预览被拒（40301/49403）', async () => {
    await expect(previewWriteAction(student, 'disable_users', { all: true, role: 'student' })).rejects.toThrowError(/无权/);
  });

  it('★ 只读动作不能走执行通道', async () => {
    await expect(runReadAction(admin, 'disable_users', {})).rejects.toThrowError(/需要二次确认/);
  });

  it('发公告缺标题或正文时拒绝预览', async () => {
    await expect(previewWriteAction(admin, 'publish_notice', { title: '只有标题' })).rejects.toThrowError(/标题和正文/);
  });

  it('撤回公告没给编号时拒绝预览', async () => {
    await expect(previewWriteAction(admin, 'revoke_notice', {})).rejects.toThrowError(/公告编号/);
  });

  it('处置审核没给记录编号时拒绝预览', async () => {
    await expect(previewWriteAction(admin, 'confirm_violation', {})).rejects.toThrowError(/审核记录编号/);
  });

  it('★ 拿一个"合法但目标已不存在"的令牌执行 → 明确报失效，而不是静默成功 0 条', async () => {
    const token = signConfirmToken({ userId: admin.userId, action: 'revoke_notice', params: { noticeId: 99999999 }, targetIds: [99999999] });
    await expect(executeConfirmedAction(admin, token)).rejects.toThrowError();
  });
});
