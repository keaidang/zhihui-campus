// tests/unit/ai-intent.spec.js —— 确定性意图识别与槽位抽取（lib/ai-intent.js）
//
// 这个文件的存在理由（2026-10-20 用户反馈）：
//   「审批请假怎么说都很难实现，说姓名没用，很多说法都用不了」
//   根因是"能不能听懂"完全押在模型抽参上。本文件用**表驱动**方式把各种说法钉死：
//   同一意图的 N 种措辞必须落到同一个 action、抽出同一个目标。
//   纯函数、零依赖、零 IO —— 因此可以放心穷举，不影响任何现有链路。
import { describe, it, expect } from 'vitest';
import {
  classifyIntent,
  extractNames,
  extractTargets,
  hasUsableParams,
  mergeParams,
  slotsForAction,
} from '../../node-functions/lib/ai-intent.js';

describe('classifyIntent · 各种说法必须落到同一个动作', () => {
  const cases = [
    // ---- 批准请假（正是用户说"怎么说都没用"的那一类）----
    ['审批通过方欣雪 的请假', 'approve_leaves'],
    ['批准方欣雪的请假', 'approve_leaves'],
    ['把方欣雪的假批了', 'approve_leaves'],
    ['方欣雪的请假批一下', 'approve_leaves'],
    ['给方欣雪过了吧', 'approve_leaves'],
    ['同意任杰姬的请假申请', 'approve_leaves'],
    ['审批方欣雪的请假', 'approve_leaves'],
    ['通过 2120413 这条请假', 'approve_leaves'],
    // ---- 驳回 ----
    ['驳回方欣雪的请假', 'reject_leaves'],
    ['方欣雪的不批', 'reject_leaves'],
    ['打回唐晨凡的假条', 'reject_leaves'],
    ['拒绝这条请假', 'reject_leaves'],
    // ---- 查询请假（注意：不能因为出现"审批"就误判成批准）----
    ['查询请假单', 'query_leaves'],
    ['查一下方欣雪的请假', 'query_leaves'],
    ['看看待审批的请假', 'query_leaves'],
    ['有多少条待审批的请假', 'query_leaves'],
    ['列出本周请假记录', 'query_leaves'],
    // ---- 账号 ----
    ['禁用教师账号teacher01', 'disable_users'],
    ['把teacher01停用', 'disable_users'],
    ['禁用所有学生账号', 'disable_users'],
    ['恢复 teacher02', 'enable_users'],
    ['解封teacher03', 'enable_users'],
    ['查一下有多少个学生账号', 'query_users'],
    ['有多少个禁用的账号', 'query_users'],
    // ---- 公告 ----
    ['发布公告：周末停电通知', 'publish_notice'],
    ['发个公告说周末停电', 'publish_notice'],
    ['撤回公告 12', 'revoke_notice'],
    ['删除公告 3', 'revoke_notice'],
    ['把公告置顶', 'pin_notice'],
    ['看看最新公告', 'query_notices'],
    // ---- 审核 ----
    ['确认违规记录 8', 'confirm_violation'],
    ['看看待复核的审核记录', 'query_review_queue'],
    // ---- 重置登录密码（2026-10-20 新增能力）----
    ['把teacher01的密码重置了', 'reset_user_password'],
    ['重置 nstu20260855 的登录密码', 'reset_user_password'],
    ['重置张海涛的账号密码', 'reset_user_password'],
    ['给方欣雪改密码', 'reset_user_password'],
  ];

  for (const [text, expected] of cases) {
    it(`「${text}」→ ${expected}`, () => {
      const r = classifyIntent(text);
      expect(r, `规则层没识别出来：${text}`).toBeTruthy();
      expect(r.action).toBe(expected);
      expect(r.score).toBeGreaterThan(0);
    });
  }

  it('★ 不是操作的句子一律交还模型（不能被宾语误触发）', () => {
    for (const text of ['你好', '请假流程是什么', '学校有几个学院', '这道题怎么写', '重置一下筛选条件']) {
      expect(classifyIntent(text), text).toBeNull();
    }
  });

  it('★ 反例词：重置"邮箱"密码不是重置登录密码（两者是完全不同的能力）', () => {
    expect(classifyIntent('重置 teacher01 的邮箱密码')).toBeNull();
  });

  it('打了平手时返回 null（宁可交给模型，也不猜）', () => {
    // 「撤销」既可能是撤公告、也可能是撤审批 —— 没有宾语时不应下判断
    expect(classifyIntent('撤销一下')).toBeNull();
  });
});

describe('extractNames · 姓名候选（命中与否仍由 SQL 判断）', () => {
  const cases = [
    ['审批通过方欣雪的请假', '方欣雪'],
    ['批准 方欣雪 的请假', '方欣雪'],
    ['把方欣雪的假批了', '方欣雪'],
    ['驳回唐晨凡的假条', '唐晨凡'],
    ['同意任杰姬的请假申请', '任杰姬'],
    ['给方欣雪过了吧', '方欣雪'],
  ];
  for (const [text, name] of cases) {
    it(`「${text}」→ 含「${name}」`, () => {
      expect(extractNames(text)).toContain(name);
    });
  }

  it('不把动词/宾语碎片当人名', () => {
    for (const t of ['查询请假单', '看看待审批的请假', '确认违规记录 8', '把公告置顶']) {
      const names = extractNames(t);
      expect(names, `${t} → ${JSON.stringify(names)}`).not.toContain('查询');
      expect(names).not.toContain('待审批');
      expect(names).not.toContain('确认违规');
    }
  });

  it('空值安全', () => {
    expect(extractNames('')).toEqual([]);
    expect(extractNames(null)).toEqual([]);
  });
});

describe('extractTargets · 单号 / 账号 / 状态 / 批量 / 编号', () => {
  it('标签单号与裸长数字都能抽到', () => {
    expect(extractTargets('通过单号 2120413').leaveIds).toContain(2120413);
    expect(extractTargets('批准 2120413 这条').leaveIds).toContain(2120413);
  });

  it('短数字不会被误当单号（避免把"7 天""30 条"当 id）', () => {
    const s = extractTargets('批准 7 天以内的请假');
    expect(s.leaveIds || []).toEqual([]);
  });

  it('账号：含数字的 ASCII token', () => {
    expect(extractTargets('禁用教师账号teacher01').usernames).toContain('teacher01');
    expect(extractTargets('恢复 student580').usernames).toContain('student580');
  });

  it('公告 / 审核记录编号允许 1~3 位', () => {
    expect(extractTargets('撤回公告 12').noticeId).toBe(12);
    expect(extractTargets('确认违规记录 8').reviewId).toBe(8);
  });

  it('状态词映射', () => {
    expect(extractTargets('看看待审批的请假').status).toBe('1');
    expect(extractTargets('列出已批准的请假').status).toBe('2');
    expect(extractTargets('看看已驳回的请假').status).toBe('3');
    expect(extractTargets('查一下已销假的记录').status).toBe('4');
  });

  it('★「都」不算批量（"他的假都批了"不是"批所有"）', () => {
    expect(extractTargets('方欣雪的假都批了').all).toBeUndefined();
    expect(extractTargets('批准所有待审批的请假').all).toBe(true);
  });

  it('账号状态：禁用/正常要能区分（否则"有多少个禁用的账号"会返回全校总数）', () => {
    expect(extractTargets('有多少个禁用的账号').accountStatus).toBe('0');
    expect(extractTargets('看看启用中的账号').accountStatus).toBe('1');
    expect(slotsForAction(extractTargets('有多少个禁用的账号'), 'query_users')).toEqual({ countOnly: '1', status: '0' });
  });

  it('审批意见与公告标题/正文', () => {
    expect(extractTargets('驳回方欣雪的请假，原因：材料不全').opinion).toBe('材料不全');
    const n = extractTargets('发布公告 标题：周末停电 内容：周六 8 点至 12 点停电');
    expect(n.title).toBe('周末停电');
    expect(n.content).toContain('周六 8 点');
  });
});


describe('mergeParams · 模型优先、规则补空、数组取并集', () => {
  it('模型给的标量不被规则覆盖', () => {
    expect(mergeParams({ status: '2' }, { status: '1' }).status).toBe('2');
  });

  it('模型没给的由规则补上', () => {
    expect(mergeParams({}, { status: '1', all: true })).toEqual({ status: '1', all: true });
  });

  it('★ 数组取并集（"方欣雪和唐晨凡"不能只处理一半）', () => {
    const m = mergeParams({ names: ['方欣雪'] }, { names: ['唐晨凡'] });
    expect(m.names.sort()).toEqual(['唐晨凡', '方欣雪'].sort());
  });

  it('空值/异常输入安全', () => {
    expect(mergeParams(null, null)).toEqual({});
    expect(mergeParams({ a: '' }, { a: 'x' }).a).toBe('x');
  });

  it('hasUsableParams 能识别"看起来有参数其实全空"', () => {
    expect(hasUsableParams({})).toBe(false);
    expect(hasUsableParams({ leaveIds: [] })).toBe(false);
    expect(hasUsableParams({ keyword: '' })).toBe(false);
    expect(hasUsableParams({ keyword: '方欣雪' })).toBe(true);
  });
});

describe('slotsForAction · 只把有意义的槽位交给对应动作', () => {
  const slots = { names: ['周末电'], title: '周末停电', content: '周六停电', usernames: ['teacher01'], noticeId: 12, reviewId: 8 };

  it('请假动作只拿姓名/单号/批量/意见，不会拿到公告编号', () => {
    const s = slotsForAction(slots, 'approve_leaves');
    expect(s.leaveIds).toBeUndefined();
    expect(s.usernames).toEqual(['teacher01']); // 模型常把姓名塞进 usernames
    expect(s.noticeId).toBeUndefined();
  });

  it('撤回公告只拿公告编号', () => {
    expect(slotsForAction(slots, 'revoke_notice')).toEqual({ noticeId: 12 });
  });

  it('发布公告只拿标题/正文（不会把"周末电"当人名去查库）', () => {
    expect(slotsForAction(slots, 'publish_notice')).toEqual({ title: '周末停电', content: '周六停电' });
  });

  it('未知动作返回空对象', () => {
    expect(slotsForAction(slots, 'drop_all_tables')).toEqual({});
  });
});

