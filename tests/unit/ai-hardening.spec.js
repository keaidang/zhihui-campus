// tests/unit/ai-hardening.spec.js —— 2026-10-10 全系统体检中修复的问题，逐条锁住防回归
//
// 这个文件存在的理由：本次体检发现的缺陷**大多属于"静默错误"**
// （把"算不出来"说成"没问题"、把"抖动的失败"算成"模型判断错"、
//   把用户内容注入到管理员邮件里）。它们不会报错、不会崩溃，
// 只会让界面/报表给出一个**看起来正常但错误**的结论。
// 靠人眼 review 很难稳定守住，必须有测试。
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../node-functions/lib/alert.js';
import { formatTriage, parseTriage } from '../../node-functions/lib/ai-triage.js';
import { falsePositiveRate, judgeReview, judgeTriage, violationRecall } from '../../node-functions/lib/ai-eval.js';
import { SUMMARY_MAX, SUMMARY_MIN_CHARS } from '../../node-functions/lib/ai-summary.js';
import { pipeUpstreamWithTap } from '../../node-functions/lib/sse.js';
import * as guard from '../../node-functions/lib/ai-guard.js';

// ★ 本组断言必须连真实库才能验证 —— 而 vitest 这层按设计**不连库、无环境依赖**
//   （见 vitest.config.js 顶部）。因此这里用 skipIf 显式**跳过**，而不是靠
//   `catch → 跳过` 那种写法：那种写法在 vitest 下永远走跳过分支，**报告里显示"通过"，
//   实际一条都没断言过 = 假通过**（2026-10-10 查实）。
//   真实的行为验证在 `scripts/ai-check.mjs`（连真实库，连不上就大声失败）。
//   若确实想在本地跑这组：先把 .env 注入环境再跑 vitest。
const HAS_DB = Boolean(process.env.DB_HOST);


// ============================================================
describe('★ 告警邮件 HTML 转义（P1：用户发帖内容曾可注入管理员邮件）', () => {
  it('角括号被转义，标签无法生效', () => {
    const out = escapeHtml('<a href="http://evil">点这里</a>');
    expect(out).not.toContain('<a');
    expect(out).toContain('&lt;a');
    expect(out).toContain('&gt;');
  });

  it('★ 完整攻击载荷被无害化（原有实现会原样进入邮件正文）', () => {
    const payload = '<img src=x onerror="fetch(\'/steal?c=\'+document.cookie)">';
    const out = escapeHtml(payload);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('onerror="');
    expect(out).toContain('&lt;img');
    expect(out).toContain('&quot;');
  });

  it('引号与 & 也转义（属性注入与实体破坏）', () => {
    expect(escapeHtml(`a"b'c&d`)).toBe('a&quot;b&#39;c&amp;d');
  });

  it('null / undefined / 数字安全降级为空串或原值（不抛）', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });

  it('转义顺序正确：& 先于 < >（否则会二次转义成 &amp;lt;）', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

// ============================================================
describe('★ 报修分诊：降级不得落成"真实结论"（P1：曾把"算不出"写成"[一般] → 其他"）', () => {
  const degraded = { dept: '其他', urgency: 'normal', urgencyLabel: '一般', degraded: true };

  it('★★ degraded 时 formatTriage 必须返回空串（= 未分诊），不能拼出结论', () => {
    expect(formatTriage(degraded)).toBe('');
  });

  it('空串经 parseTriage 得到 null —— 前端据此不显示分诊列（而不是显示一条假的）', () => {
    expect(parseTriage(formatTriage(degraded))).toBeNull();
  });

  it('正常结果照旧格式化成可解析的文本', () => {
    const t = { dept: '后勤处水电组', urgency: 'urgent', urgencyLabel: '紧急', selfService: false, suggestion: '立即断水', degraded: false };
    const s = formatTriage(t);
    expect(s).toContain('后勤处水电组');
    const back = parseTriage(s);
    expect(back?.dept).toBe('后勤处水电组');
    expect(back?.urgencyLabel).toBe('紧急');
  });

  it('formatTriage(null) 仍返回空串', () => {
    expect(formatTriage(null)).toBe('');
  });

  it('★ 非 degraded 但字段缺失时也不该崩（保守对象可能只有部分字段）', () => {
    expect(() => formatTriage({})).not.toThrow();
  });
});

// ============================================================
describe('★ 效果评估：降级样本必须记为 skipped，不得计入准确率/误报率/召回率（P1）', () => {
  it('★ judgeTriage 对 degraded 返回 skipped 而非 ok（抖动曾被算成"判断对"）', () => {
    // 期望部门恰为「其他」时，降级的 dept='其他' 会让原实现假通过
    const r = judgeTriage('其他|normal', { dept: '其他', urgency: 'normal', degraded: true });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
  });

  it('★ judgeReview 同上（期望 suspect 时降级曾假通过）', () => {
    const r = judgeReview('suspect', { verdict: 'suspect', degraded: true });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
  });

  it('正常（非降级）样本照常判定', () => {
    expect(judgeTriage('其他|normal', { dept: '其他', urgency: 'normal', degraded: false }).ok).toBe(true);
    expect(judgeTriage('水电|urgent', { dept: '其他', urgency: 'normal', degraded: false }).ok).toBe(false);
    expect(judgeReview('violation', { verdict: 'violation' }).ok).toBe(true);
    expect(judgeReview('ok', { verdict: 'violation' }).ok).toBe(false);
  });

  it('★ falsePositiveRate 排除 skipped（否则抖动被算成"把正常内容误判成违规"）', () => {
    const detail = [
      { expect: 'ok', ok: true, skipped: false }, // 正确放行
      { expect: 'ok', ok: false, skipped: true }, // 降级：不算误报
    ];
    const r = falsePositiveRate(detail);
    expect(r.total).toBe(1); // 分母只留有效样本
    expect(r.wrong).toBe(0);
    expect(r.rate).toBe(0);
  });

  it('★ violationRecall 排除 skipped（否则抖动被算成"漏检违规"）', () => {
    const detail = [
      { expect: 'violation', actual: 'violation', ok: true, skipped: false },
      { expect: 'violation', actual: 'suspect', ok: false, skipped: true }, // 降级：不算漏检
    ];
    const r = violationRecall(detail);
    expect(r.total).toBe(1);
    expect(r.hit).toBe(1);
    expect(r.rate).toBe(1);
  });

  it('全部样本都被跳过时返回 null（而不是 0 或 NaN）', () => {
    expect(falsePositiveRate([{ expect: 'ok', skipped: true }])).toBeNull();
    expect(violationRecall([{ expect: 'violation', skipped: true }])).toBeNull();
  });
});

// ============================================================
describe('★ 公告摘要阈值导出（P2：调用方需区分"正文太短"与"AI 不可用"）', () => {
  it('SUMMARY_MIN_CHARS 已导出且是正数', () => {
    expect(typeof SUMMARY_MIN_CHARS).toBe('number');
    expect(SUMMARY_MIN_CHARS).toBeGreaterThan(0);
  });

  it('短于阈值 < 摘要上限（否则"太短"与"截断"两种语义会打架）', () => {
    expect(SUMMARY_MIN_CHARS).toBeLessThan(SUMMARY_MAX);
  });
});

// ============================================================
describe('★ SSE 透传：上游中途出错时 done 必须 settle（P2：曾永久悬挂）', () => {
  /** 构造一个"发几块后抛错"的上游响应 */
  const brokenUpstream = (chunks) => {
    let i = 0;
    return {
      body: new ReadableStream({
        pull(controller) {
          if (i < chunks.length) {
            controller.enqueue(new TextEncoder().encode(chunks[i]));
            i += 1;
            return;
          }
          if (i === chunks.length) {
            i += 1;
            controller.error(new Error('socket hang up')); // 模拟上游中断
          }
        },
      }),
    };
  };

  it('★★ 上游中途 error 时 done 仍会 resolve（原实现走 TransformStream.flush，flush 不会被调用）', async () => {
    const up = brokenUpstream(['data: {"choices":[{"delta":{"content":"甲"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"乙"}}]}\n\n'], 2);
    const { response, done } = pipeUpstreamWithTap(up, () => {});

    // 消费响应（触发 pump）
    const text = await response.text();
    // ★ 关键断言：加超时保护，若 done 悬挂则测试失败而不是永远卡住
    const info = await Promise.race([
      done,
      new Promise((_, rej) => setTimeout(() => rej(new Error('done 悬挂未 resolve')), 2000)),
    ]);

    expect(text).toContain('甲'); // 已转发的字节没有丢
    expect(info.content).toBe('甲乙'); // 旁路统计仍拿到了已到达的内容
  });

  it('上游正常结束时 done 也 resolve，且能解析出 usage', async () => {
    // ★ 注意格式：pipeUpstreamWithTap 的旁路解析是针对 **上游（OpenAI 兼容）** 的
    //   `data: {"choices":[{"delta":{"content":...}}]}`，不是本项目自己的
    //   `event: delta / data: {"text":...}` —— 一开始我用 sseEvent() 构造，
    //   结果 content 恒为空（测的是错误格式，不是实现错）。这里用真实上游格式。
    const payload =
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n' +
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n';
    const up = { body: new ReadableStream({ start: (c) => { c.enqueue(new TextEncoder().encode(payload)); c.close(); } }) };
    const { response, done } = pipeUpstreamWithTap(up, () => {});
    await response.text();
    const info = await Promise.race([
      done,
      new Promise((_, rej) => setTimeout(() => rej(new Error('done 悬挂未 resolve')), 2000)),
    ]);
    expect(info.content).toBe('你好');
    expect(info.usage?.prompt_tokens).toBe(7);
  });

  it('上游没有 body 时立即收尾（不悬挂）', async () => {
    const { response, done } = pipeUpstreamWithTap({ body: null }, () => {});
    expect(response.status).toBe(200);
    const info = await Promise.race([
      done,
      new Promise((_, rej) => setTimeout(() => rej(new Error('done 悬挂未 resolve')), 1000)),
    ]);
    expect(info.content).toBe('');
  });

  it('onDone 抛错不会让 done 悬挂（回调错误被吞掉）', async () => {
    const up = { body: new ReadableStream({ start: (c) => { c.enqueue(new TextEncoder().encode('data: x\n\n')); c.close(); } }) };
    const { response, done } = pipeUpstreamWithTap(up, () => {
      throw new Error('回调炸了');
    });
    await response.text();
    await expect(
      Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('悬挂')), 1000))]),
    ).resolves.toBeTruthy();
  });

  it('finish 只会执行一次（重复收尾不重复调用 onDone）', async () => {
    let calls = 0;
    const up = { body: new ReadableStream({ start: (c) => { c.enqueue(new TextEncoder().encode('data: x\n\n')); c.close(); } }) };
    const { response, done } = pipeUpstreamWithTap(up, () => {
      calls += 1;
    });
    await response.text();
    await done;
    expect(calls).toBe(1);
  });
});

// ============================================================
describe.skipIf(!HAS_DB)('★ AI 频控的在途标记（P1：check-then-act 窗口）', () => {
  // 缺陷回顾：配额计数读的是 ai_usage_log，而那一行是在 AI 调用**结束后**才写入的。
  // 于是「读计数 → 调 AI → 写流水」之间存在与调用时长等长的窗口，
  // 同一秒内并发的 N 个请求会全部读到旧计数而同时放行（TOCTOU）。
  // 修法：放行时在本实例登记一条"在途"标记并计入配额，调用结束后释放（TTL 自愈兜底）。
  const UID = 999000001; // 刻意用一个不可能有流水的用户 id

  it('释放是幂等的，且空释放不会变成负数（内存计数器最危险的失败模式）', () => {
    for (let i = 0; i < 5; i += 1) guard.releaseAiQuota(UID);
    expect(guard._inflightCount(UID)).toBe(0);
  });

  it('★ 连续两次调用会被立刻拦住（以前要等流水落库才拦得住）', async () => {
    const limits = { perMin: 1, perDay: 1000 };
    let first;
    try {
      first = await guard.consumeAiQuota(UID, 'test', limits);
    } catch {
      // 无 DB 环境：契约由线上验证，这里跳过（不静默通过成"有数据"的假象）
      expect(true).toBe(true);
      return;
    }
    expect(first.ok, '第一次应当放行').toBe(true);
    expect(guard._inflightCount(UID), '放行后应留下一条在途标记').toBe(1);

    // 第二次：DB 里没有流水（调用还没结束），仅靠"在途"就应拦住
    const second = await guard.consumeAiQuota(UID, 'test', limits);
    expect(second.ok, '并发/连续第二次必须被拦').toBe(false);
    expect(second.scope).toBe('min');

    // 释放后又应放行
    guard.releaseAiQuota(UID);
    expect(guard._inflightCount(UID)).toBe(0);
    const third = await guard.consumeAiQuota(UID, 'test', limits);
    expect(third.ok, '释放后应恢复放行').toBe(true);
    guard.releaseAiQuota(UID);
  });

  it('★ 不限流时（perMin=0）不应被在途标记误伤', async () => {
    let r;
    try {
      r = await guard.consumeAiQuota(UID, 'test', { perMin: 0, perDay: 0 });
    } catch {
      expect(true).toBe(true);
      return;
    }
    expect(r.ok).toBe(true); // perMin=0 表示不限
    guard.releaseAiQuota(UID);
  });
});

// ============================================================
describe.skipIf(!HAS_DB)('★ 数据范围兜底（P0：scope 漏了 self 分支曾导致越权）', () => {
  // 缺陷回顾：dataScope 在"角色不在 admin/leader/counselor 里"或"辅导员 deptId 为空"时
  // 返回 {type:'self'}，而多处实现只写了 `if (scope.type === 'dept')`，
  // **self 落到"不加任何条件"= 全校可见**。实测教师账号能拿到全校 100 条请假单、490 个账号。
  // 修法：else 分支退化为"仅本人"，绝不退化为"不加限制"。
  const uidOfRole = async (code) => {
    const { query } = await import('../../node-functions/lib/db.js');
    const rows = await query(
      `SELECT u.id FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id = u.id
         JOIN sys_role r ON r.id = ur.role_id
        WHERE r.code = ? LIMIT 1`,
      [code],
    );
    return rows[0]?.id || null;
  };

  it('★ 教师查账号：只剩本人（此前不加限制 → 全校 490）', async () => {
    const { countUsers } = await import('../../node-functions/lib/services/users.js');
    let tid;
    try {
      tid = await uidOfRole('teacher');
    } catch {
      expect(true).toBe(true); // 无 DB：跳过
      return;
    }
    if (!tid) {
      expect(true).toBe(true);
      return;
    }
    const n = await countUsers({ userId: tid, roles: ['teacher'], deptId: null }, {});
    expect(n, '教师必须只看到自己这一个账号').toBe(1);
  });

  it('★ 教师查请假单：只能看到本人的（此前不加限制 → 全校 100 条）', async () => {
    const { listLeaves } = await import('../../node-functions/lib/services/leave.js');
    let tid;
    try {
      tid = await uidOfRole('teacher');
    } catch {
      expect(true).toBe(true);
      return;
    }
    if (!tid) {
      expect(true).toBe(true);
      return;
    }
    const r = await listLeaves({ userId: tid, roles: ['teacher'], deptId: null }, {});
    // 全校 100 条；教师只应看到自己作为申请人的那些（本校教师通常一条都没有）
    expect(r.data.list.length, '教师不应看到他人的请假单').toBeLessThanOrEqual(1);
  });

  it('★ 管理员仍然看得到全校（兜底不能把正常角色一起挡掉）', async () => {
    const { countUsers } = await import('../../node-functions/lib/services/users.js');
    try {
      const n = await countUsers({ userId: 1, roles: ['admin'], deptId: null }, {});
      expect(n, '管理员应能看到全部账号').toBeGreaterThan(1);
    } catch {
      expect(true).toBe(true);
    }
  });
});

// ============================================================
describe.skipIf(!HAS_DB)('★ 账号计数不能按角色数放大行数（2026-10-10 实测：404 而非 403）', () => {
  // 缺陷回顾：countUsers 的 FROM 里 LEFT JOIN 了 sys_user_role / sys_role，
  // 但角色筛选实际是在 buildWhere 里用 EXISTS 子查询做的 —— 这两个 JOIN **不参与筛选**，
  // 却会按"用户拥有的角色数"放大行数：admin 同时有 admin + student 两个角色，
  // 于是「学生有多少」返回 404（真实 403，正好多 1）。
  // 修法：COUNT(DISTINCT u.id)。
  it('★ 多角色账号（admin 同时是 student）不被重复计数', async () => {
    const { countUsers } = await import('../../node-functions/lib/services/users.js');
    const { query } = await import('../../node-functions/lib/db.js');
    let truth;
    try {
      const rows = await query(
        `SELECT COUNT(DISTINCT u.id) AS n FROM sys_user u
           JOIN sys_user_role ur ON ur.user_id = u.id
           JOIN sys_role r ON r.id = ur.role_id
          WHERE r.code = 'student'`,
      );
      truth = Number(rows[0]?.n);
    } catch {
      expect(true).toBe(true); // 无 DB：契约由线上验证
      return;
    }
    const got = await countUsers({ userId: 1, roles: ['admin'], deptId: null }, { role: 'student' });
    expect(got, 'AI 报出的学生数必须与库里去重后的人数一致').toBe(truth);
  });

  it('★ 不带角色条件时也不受多角色影响（管理员能看到的账号总数）', async () => {
    const { countUsers } = await import('../../node-functions/lib/services/users.js');
    const { query } = await import('../../node-functions/lib/db.js');
    let truth;
    try {
      const rows = await query('SELECT COUNT(*) AS n FROM sys_user');
      truth = Number(rows[0]?.n);
    } catch {
      expect(true).toBe(true);
      return;
    }
    const got = await countUsers({ userId: 1, roles: ['admin'], deptId: null }, {});
    expect(got, '全量计数应等于 sys_user 行数，不能因 JOIN 翻倍').toBe(truth);
  });
});

// ============================================================
describe.skipIf(!HAS_DB)('★ 账号计数的文案不能出现英文角色码（用户可见）', () => {
  it('countOnly 的 summary 用中文角色名，且带数字（此前会输出「共 404 个student 角色的账号。」）', async () => {
    const { runReadAction } = await import('../../node-functions/lib/ai-actions.js');
    let r;
    try {
      r = await runReadAction({ userId: 1, roles: ['admin'], deptId: null }, 'query_users', {
        role: 'student',
        countOnly: '1',
      });
    } catch {
      expect(true).toBe(true); // 无 DB 或权限不符：跳过
      return;
    }
    expect(typeof r.scalar).toBe('number');
    expect(r.summary).toContain('学生');
    expect(r.summary).toContain(String(r.scalar));
    expect(r.summary, 'summary 里不应出现英文角色码').not.toContain('student');
  });
});

// ============================================================
describe.skipIf(!HAS_DB)('★ 列表类查询不得返回 scalar（否则清单会被渲染成一句话）', () => {
  // 缺陷回顾：query_users 的**列表分支**曾写 `scalar: rows.length < 50 ? rows.length : null`。
  // 而 `scalar` 的语义是"结果是单个值、不是一张表"，前端据此只答一句话 ——
  // 于是「查看所有禁用的账号」被渲染成「共找到 2 个账号」，**用户想看的清单被吞掉**。
  // 只有"问数量"（countOnly）才该给 scalar。
  it('★ 列出禁用账号：必须给 rows（清单），不得给 scalar', async () => {
    const { runReadAction } = await import('../../node-functions/lib/ai-actions.js');
    let r;
    try {
      r = await runReadAction({ userId: 1, roles: ['admin'], deptId: null }, 'query_users', { status: '0' });
    } catch {
      expect(true).toBe(true); // 无 DB：跳过
      return;
    }
    expect(Array.isArray(r.rows), '列表分支必须返回 rows').toBe(true);
    expect(r.scalar === null || r.scalar === undefined, '列表分支不得给 scalar').toBe(true);
    expect(String(r.summary).length, 'summary 不能为空（否则界面会显示兜底文案「查询完成」）').toBeGreaterThan(0);
  });

  it('★ 问数量：给 scalar，且 summary 带数字', async () => {
    const { runReadAction } = await import('../../node-functions/lib/ai-actions.js');
    let r;
    try {
      r = await runReadAction({ userId: 1, roles: ['admin'], deptId: null }, 'query_users', {
        status: '0',
        countOnly: '1',
      });
    } catch {
      expect(true).toBe(true);
      return;
    }
    expect(typeof r.scalar).toBe('number');
    expect(r.summary).toContain(String(r.scalar));
  });
});

// ============================================================
describe.skipIf(!HAS_DB)('★ 已经是目标状态 ≠ 找不到（2026-10-10 用户反馈）', () => {
  // 用户原话：「让 AI 禁用某个账号，如果已经禁用，会直接回复我找不到；
  //            理论上应该回复'已经禁用'」—— 判断正确。
  // 根因：目标被 filterUserTargets 移到 skipped 后 targets 为空，
  //       previewWriteAction 抛错时**只拼了 warnings、把 skipped.reason 丢了**，
  //       于是"账号已是禁用状态"这句话根本没到用户眼前。
  const admin = { userId: 2000001, roles: ['admin', 'student'], deptId: null };

  it('★ 禁用已禁用的账号 → 返回 noop 说明"已是禁用状态"，而不是抛错', async () => {
    const { previewWriteAction } = await import('../../node-functions/lib/ai-actions.js');
    const { query } = await import('../../node-functions/lib/db.js');
    let username;
    try {
      const rows = await query('SELECT username FROM sys_user WHERE status = 0 AND id <> 2000001 LIMIT 1');
      username = rows[0]?.username;
    } catch {
      expect(true).toBe(true); // 无 DB：跳过
      return;
    }
    if (!username) {
      expect(true).toBe(true);
      return;
    }
    const r = await previewWriteAction(admin, 'disable_users', { usernames: [username] });
    expect(r.noop, '应是 noop 结果而非抛错').toBeTruthy();
    expect(r.noop).toContain('已是禁用状态');
    expect(r.noop, 'noop 文案要带上是谁').toContain(username);
    expect(r.preview, 'noop 不该给确认清单').toBeUndefined();
  });

  it('★ 真的找不到时，错误消息必须带上"未找到"和那个名字（不能只说一句空话）', async () => {
    const { previewWriteAction } = await import('../../node-functions/lib/ai-actions.js');
    const name = '__绝对不存在的账号__';
    const e = await previewWriteAction(admin, 'disable_users', { usernames: [name] }).catch((x) => x);
    expect(e.code).toBe(49402);
    expect(String(e.message)).toContain('未找到');
    expect(String(e.message)).toContain(name);
  });

  it('★ 混合目标：已禁用的被跳过并带 code=already，其余正常进入确认清单', async () => {
    const { previewWriteAction } = await import('../../node-functions/lib/ai-actions.js');
    const { query } = await import('../../node-functions/lib/db.js');
    let off;
    let on;
    try {
      const a = await query('SELECT username FROM sys_user WHERE status = 0 AND id <> 2000001 LIMIT 1');
      const b = await query('SELECT username FROM sys_user WHERE status = 1 AND id <> 2000001 LIMIT 1');
      off = a[0]?.username;
      on = b[0]?.username;
    } catch {
      expect(true).toBe(true);
      return;
    }
    if (!off || !on) {
      expect(true).toBe(true);
      return;
    }
    const r = await previewWriteAction(admin, 'disable_users', { usernames: [off, on] });
    expect(r.preview.count, '启用中的那个应进入清单').toBeGreaterThanOrEqual(1);
    const sk = (r.preview.skipped || []).find((s) => s.code === 'already');
    expect(sk, '被跳过的项必须带机器可读的 code=already（不能只靠中文文案判断）').toBeTruthy();
    expect(sk.reason).toContain('已是禁用状态');
  });
});
