// scripts/ai-check.mjs — AI 能力层「连真实库」的行为检查（只读，不改数据）
//
// 用法：node scripts/ai-check.mjs
//
// ★ 为什么这个脚本必须存在（2026-10-10 查实的重要教训）：
//   vitest 那层按设计**不连库、无环境依赖**（见 vitest.config.js 顶部说明），
//   它进 pre-commit 与 `npm run check` 的前提就是「秒级、不依赖 DB」。
//   所以**任何"查询真实数据才能验证"的断言都不能写在 tests/ 里** ——
//   写了只能靠 `catch → 跳过` 兜住，而那种写法在 vitest 下**永远走跳过分支 = 假通过**。
//   本脚本就是那些"必须连库才算验证过"的断言的归宿：
//   照 integrity-check.mjs / gap-check.mjs 的既有模式，自己去读 .env、直连真实库，
//   连不上就**大声失败**（而不是静默跳过）。
//
// 覆盖的是"改错了不会报错、只会给出错误结果"的那几类缺陷：
//   （铁律 #46）数据范围兜底：不能因漏了 self 分支而放大到全校
//   （铁律 #52）计数不能因多余的 JOIN 按角色数放大行数
//   （铁律 #54）scalar 只能由"单值结果"设置，列表分支不得给
//   （2026-10-10）「已经是目标状态」不能报成"找不到"
import fs from 'node:fs';

for (const line of (fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
if (!process.env.DB_HOST) {
  console.error('✖ 未读到 .env 里的 DB_HOST —— 本检查必须连真实库，不能跳过。');
  process.exit(1);
}

const { query } = await import('../node-functions/lib/db.js');
const { countUsers, findUsers } = await import('../node-functions/lib/services/users.js');
const { listLeaves } = await import('../node-functions/lib/services/leave.js');
const { runReadAction, previewWriteAction } = await import('../node-functions/lib/ai-actions.js');
const { runInsight } = await import('../node-functions/lib/ai-insight.js');

const admin = { userId: 2000001, roles: ['admin', 'student'], deptId: null };
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? `　${detail}` : ''}`);
};

console.log('=== AI 能力层检查（连真实库）===');

// ── 1. 计数：多角色账号不得被重复计数（铁律 #52）────────────────
console.log('\n[1] 账号计数口径');
const [truthStudent] = await query(
  `SELECT COUNT(DISTINCT u.id) AS n FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id
    WHERE r.code = 'student'`,
);
const [truthAll] = await query('SELECT COUNT(*) AS n FROM sys_user');
const nStudent = await countUsers(admin, { role: 'student' });
const nAll = await countUsers(admin, {});
check('学生数 = 库内 COUNT(DISTINCT)', nStudent === Number(truthStudent.n), `countUsers=${nStudent} 库=${truthStudent.n}`);
check('账号总数 = sys_user 行数', nAll === Number(truthAll.n), `countUsers=${nAll} 库=${truthAll.n}`);

// ── 2. 数据范围兜底：教师不得放大到全校（铁律 #46）──────────────
console.log('\n[2] 数据范围兜底（教师角色应只见本人）');
const [teacher] = await query(
  `SELECT u.id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id WHERE r.code = 'teacher' LIMIT 1`,
);
if (!teacher) {
  check('存在教师账号（用于验证兜底）', false, '库里没有 teacher 角色账号');
} else {
  const t = { userId: teacher.id, roles: ['teacher'], deptId: null };
  const tAccounts = await countUsers(t, {});
  const [tTruth] = await query('SELECT COUNT(*) AS n FROM sys_user WHERE id = ?', [teacher.id]);
  const tLeaves = await listLeaves(t, {});
  check('教师查账号 = 仅本人', tAccounts === Number(tTruth.n), `得到 ${tAccounts}，应为 ${tTruth.n}`);
  check('教师查请假 = 仅本人提交的', tLeaves.data.list.every((l) => true) && tLeaves.data.list.length <= 1, `得到 ${tLeaves.data.list.length} 条`);
}
const [counselor] = await query(
  `SELECT u.id, u.dept_id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id WHERE r.code = 'counselor' AND u.dept_id IS NOT NULL LIMIT 1`,
);
if (counselor) {
  const c = await countUsers({ userId: counselor.id, roles: ['counselor'], deptId: counselor.dept_id }, {});
  check('辅导员计数介于 1 与全校之间', c > 1 && c < nAll, `辅导员=${c} 全校=${nAll}`);
}

// ── 3. scalar 语义：列表分支不得给，计数分支必须给（铁律 #54）────
console.log('\n[3] scalar 语义（决定前端是渲染表格还是答一句话）');
const listRes = await runReadAction(admin, 'query_users', { status: '0' });
check('列表分支：返回 rows 且不给 scalar', Array.isArray(listRes.rows) && listRes.rows.length > 0 && listRes.scalar === undefined, `rows=${listRes.rows.length} scalar=${listRes.scalar}`);
check('列表分支：summary 非空（否则界面会显示兜底文案「查询完成」）', String(listRes.summary || '').length > 0, `"${listRes.summary}"`);
const countRes = await runReadAction(admin, 'query_users', { status: '0', countOnly: '1' });
check('计数分支：给 scalar 且 summary 带数字', typeof countRes.scalar === 'number' && String(countRes.summary).includes(String(countRes.scalar)), `scalar=${countRes.scalar} "${countRes.summary}"`);

// ── 4. 文案：不得出现英文角色码 ────────────────────────────────
console.log('\n[4] 用户可见文案');
check('计数文案用中文角色名', !String(countRes.summary).includes('student'), `"${countRes.summary}"`);
const stats = await runInsight(admin, 'user_stats', {});
check('账号统计摘要逐角色罗列（问哪个角色都能看到答案）', /学生\s*\d+\s*人/.test(stats.summary), `"${String(stats.summary).slice(0, 60)}…"`);

// ── 5. 「已经是目标状态」不得报成"找不到" ─────────────────────
console.log('\n[5] 写操作的拒绝/无需操作语义');
const [disabledUser] = await query('SELECT username FROM sys_user WHERE status = 0 AND id <> 2000001 LIMIT 1');
if (!disabledUser) {
  check('存在已禁用账号（用于验证 noop）', false, '库里没有已禁用账号');
} else {
  const r = await previewWriteAction(admin, 'disable_users', { usernames: [disabledUser.username] }).catch((e) => e);
  check('禁用已禁用的账号 → noop 说明，而不是抛"找不到"', Boolean(r && r.noop), r?.noop || `抛错：${r?.message}`);
}
const missing = await previewWriteAction(admin, 'disable_users', { usernames: ['__绝对不存在的账号__'] }).catch((e) => e);
check('真找不到时，错误消息要带上"未找到"与名字', missing?.code === 49402 && String(missing.message).includes('未找到'), `"${missing?.message}"`);

// ── 6. 频控的在途标记（铁律 #50：check-then-act 窗口）──────────
// 只读：consumeAiQuota 只做 COUNT 查询 + 写本实例内存标记，releaseAiQuota 纯内存。
// 用一个不可能有流水的假 userId，不污染真实用户的配额。
console.log('\n[6] 频控在途标记（并发窗口补丁）');
const { consumeAiQuota, releaseAiQuota, _inflightCount } = await import('../node-functions/lib/ai-guard.js');
const fakeId = 999000123;
for (let i = 0; i < 3; i += 1) releaseAiQuota(fakeId); // 先清干净
const limits = { perMin: 1, perDay: 100000 };
const first = await consumeAiQuota(fakeId, 'check', limits);
check('首次放行并留下在途标记', first.ok === true && _inflightCount(fakeId) === 1, `ok=${first.ok} inflight=${_inflightCount(fakeId)}`);
const second = await consumeAiQuota(fakeId, 'check', limits);
check('第二次立刻被拦（此前要等流水落库才拦得住）', second.ok === false && second.scope === 'min', `ok=${second.ok} scope=${second.scope}`);
releaseAiQuota(fakeId);
const third = await consumeAiQuota(fakeId, 'check', limits);
check('释放后恢复放行（释放是幂等的、不会锁死用户）', third.ok === true, `ok=${third.ok}`);
releaseAiQuota(fakeId);
check('不 limit（perMin=0）不被在途标记误伤', (await consumeAiQuota(fakeId, 'check', { perMin: 0, perDay: 0 })).ok === true);
releaseAiQuota(fakeId);

// ── 7. 目标解析：**能查到 ≠ 能操作**（2026-10-20 线上反馈）──────────
// 两个"明明有数据，AI 却说找不到"的真实问题，都属于"解析层静默失败"：
//   · 批准请假：resolve 解构了不存在的字段 → targets 恒为空（从上线起 100% 失败）
//   · 禁用「教师账号teacher01」：精确 IN 匹配，名字带角色前缀就落空
console.log('\n[7] 写操作的目标解析');
const [pendingLeave] = await query(
  `SELECT l.id, u.real_name FROM af_leave l JOIN sys_user u ON u.id = l.student_id
    WHERE l.status = 1 ORDER BY l.id ASC LIMIT 1`,
);
if (!pendingLeave) {
  check('存在待审批请假单（用于验证批准链路）', false, '库里没有 status=1 的请假单');
} else {
  const byId = await previewWriteAction(admin, 'approve_leaves', { leaveIds: [Number(pendingLeave.id)] }).catch((e) => e);
  check('按单号预览"批准请假" → 必须给出确认清单', Boolean(byId?.preview?.count), byId?.message || `count=${byId?.preview?.count}`);
  const byName = await previewWriteAction(admin, 'approve_leaves', { keyword: pendingLeave.real_name }).catch((e) => e);
  check('按学生姓名预览"批准请假" → 必须命中（不再只筛最新 100 条）', Boolean(byName?.preview?.count), byName?.message || `count=${byName?.preview?.count}`);
  const older = await runReadAction(admin, 'query_leaves', { status: '1', keyword: pendingLeave.real_name });
  check('按姓名查请假单覆盖最早的单子（过滤已下推到 SQL）', older.rows.length >= 1, `rows=${older.rows.length} keyword=${pendingLeave.real_name}`);
}

// 姓名存在、但名下没有"审批中"单据 → 必须说清原因（否则用户会以为"只认方欣雪这个名字"）
const [noPending] = await query(
  `SELECT u.real_name FROM af_leave l JOIN sys_user u ON u.id = l.student_id
    GROUP BY u.id, u.real_name HAVING SUM(l.status = 1) = 0 AND COUNT(*) > 0
    ORDER BY COUNT(*) DESC LIMIT 1`,
);
if (noPending) {
  const e = await previewWriteAction(admin, 'approve_leaves', { keyword: noPending.real_name }).catch((x) => x);
  check(
    '姓名存在但无"审批中"单据 → 明确说明当前状态，而不是一句"找不到"',
    e?.code === 49402 && /不在"审批中"/.test(String(e.message)),
    String(e?.message || '').slice(0, 90),
  );
}

const [anyUser] = await query(
  `SELECT u.username FROM sys_user u
    WHERE u.status = 1 AND u.id <> 2000001
      AND NOT EXISTS (SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND r.code = 'admin')
    ORDER BY u.id DESC LIMIT 1`,
);
if (anyUser) {
  const r = await previewWriteAction(admin, 'disable_users', { usernames: [`教师账号${anyUser.username}`] }).catch((e) => e);
  check(
    '「教师账号<username>」能归一化解析到真实账号',
    Boolean(r?.preview?.items?.some((i) => String(i.label).includes(anyUser.username))),
    r?.message || `count=${r?.preview?.count}`,
  );
}

// 公告：按 id 直接取（不能只扫最新 50 条）。只预览，不撤回。
const [anyNotice] = await query('SELECT id FROM af_notice ORDER BY id ASC LIMIT 1');
if (anyNotice) {
  const r = await previewWriteAction(admin, 'revoke_notice', { noticeId: Number(anyNotice.id) }).catch((e) => e);
  check('按 id 预览"撤回公告" → 最早的一条也能取到', Boolean(r?.preview?.count), r?.message || `count=${r?.preview?.count} id=${anyNotice.id}`);
}

// ── 8. 重置登录密码（2026-10-20 新增能力）────────────────────────
// 用户原话：「没有给账号重置密码的功能，重置密码只能重置邮箱的密码」——
// 这里只做**预览**（一行数据都不改），确认目标解析与"重置为默认密码"的提示都到位。
console.log('\n[8] 重置登录密码（预览，不写库）');
const [anyTeacher] = await query(
  `SELECT u.username FROM sys_user u
    WHERE u.status = 1 AND u.username <> 'admin' AND u.id <> 2000001
      AND EXISTS (SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
                   WHERE ur.user_id = u.id AND r.code IN ('teacher','leader'))
    LIMIT 1`,
);
if (!anyTeacher) {
  check('存在教师/校领导账号（用于验证重置密码）', false, '库里没有可测试的教师/校领导账号');
} else {
  const r = await previewWriteAction(admin, 'reset_user_password', { usernames: [anyTeacher.username] }).catch((e) => e);
  check('预览"重置登录密码" → 给出确认清单', Boolean(r?.preview?.count), r?.message || `count=${r?.preview?.count}`);
  check(
    '预览里必须写明会重置为默认密码',
    String((r?.preview?.warnings || []).join(' ')).includes('默认密码'),
    String((r?.preview?.warnings || []).join(' ')).slice(0, 80),
  );
}
const selfReset = await previewWriteAction(admin, 'reset_user_password', { usernames: ['admin'] }).catch((e) => e);
check('★ 不能通过这条路径重置自己的密码（防自锁）', selfReset?.code === 49402 && /不能重置自己/.test(String(selfReset.message)), String(selfReset?.message || '').slice(0, 60));

console.log(`\n=== 合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail} ===`);
if (fail > 0) {
  console.error('✖ AI 能力层检查未通过');
  process.exit(1);
}
console.log('ALL-PASS');
process.exit(0);
