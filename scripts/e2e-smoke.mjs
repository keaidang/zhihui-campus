// scripts/e2e-smoke.mjs — 线上端到端冒烟（只读，可重复运行）
//
// 定位：把过去"每次临时手写、跑完即删"的线上验证固化成**一条可重复命令**（AUDIT P1-1 步骤 4）。
// 原则：
//   ① **全部为 GET，不产生任何数据** —— 因此可随时重跑，不会污染演示数据；
//   ② 覆盖多角色（student/admin/counselor/teacher），不只测"最顺"的那个角色；
//   ③ 含**越权边界断言**（学生打 admin 端点必须 40301）—— 越权是静默事故，必须机器化盯住；
//   ④ 含历史缺陷的回归断言（如邮箱密码不得出现在列表接口）。
//
// 运行：node scripts/e2e-smoke.mjs
//   换环境：E2E_BASE=https://xxx node scripts/e2e-smoke.mjs
// 退出码：全过 0；有失败 1（可直接用于 CI / npm run check）
const BASE = process.env.E2E_BASE || 'https://c.9o.pw';

const ACCOUNTS = {
  student: { username: 'student004', password: 'Zhihui@2026' },
  admin: { username: 'admin', password: 'admin' },
  counselor: { username: 'counselor01', password: 'Zhihui@2026' },
  teacher: { username: 'teacher01', password: 'Zhihui@2026' },
};

const results = [];
const log = (s) => console.log(s);

async function call(path, token) {
  const res = await fetch(BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

/** POST JSON（用于"不该成功"的安全边界断言；本脚本不改动任何账号状态） */
async function postJson(path, token, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

/** 断言业务码符合预期；expect 传数组表示"多种可接受结果"（如正常态与业务态都算通过） */
async function check(name, path, token, expect = 0) {
  try {
    const { http, json } = await call(path, token);
    const pass = Array.isArray(expect) ? expect.includes(json.code) : json.code === expect;
    const extra = json.code === 0 && json.data?.list ? ` count=${json.data.list.length}`
      : json.code === 0 && json.data?.total != null ? ` total=${json.data.total}` : '';
    results.push({ name, pass, code: json.code });
    log(`${pass ? '✅' : '❌'} ${name}  code=${json.code} http=${http}${extra}${pass ? '' : ` msg=${json.message || ''}`}`);
    return json;
  } catch (e) {
    results.push({ name, pass: false, code: 'ERR' });
    log(`❌ ${name}  EXC ${String(e.message).slice(0, 80)}`);
    return {};
  }
}

/** 自定义断言（用于非 code 结构的检查） */
function assert(name, pass, detail = '') {
  results.push({ name, pass });
  log(`${pass ? '✅' : '❌'} ${name}${detail ? `  ${detail}` : ''}`);
}

async function login(role) {
  const { username, password } = ACCOUNTS[role];
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json().catch(() => ({}));
  const ok = json.code === 0;
  results.push({ name: `登录(${role})`, pass: ok, code: json.code });
  log(`${ok ? '✅' : '❌'} 登录(${role})  roles=${json.data?.user?.roles?.join(',') || '-'}`);
  return ok ? json.data.accessToken : null;
}

log(`═══ e2e 冒烟 @ ${BASE} ═══\n`);

// ── 1. 公开端点（无鉴权）────────────────────────────────────────
log('【1. 公开端点】');
await check('健康检查', '/api/health');
await check('边缘统计(KV)', '/api/edge/stats');
await check('边缘 KV 诊断', '/api/kv-check');
await check('注册可用域名', '/api/auth/register/domains');
await check('邮箱前缀占用检查', '/api/auth/register/prefix-check?prefix=zzsmoke&domain=keaidang.com');

// ── 2. 登录（四角色）──────────────────────────────────────────
log('\n【2. 四角色登录】');
const tk = {};
for (const role of ['student', 'admin', 'counselor', 'teacher']) {
  tk[role] = await login(role);
}
if (!tk.student) { log('\nFATAL: 学生登录失败，终止'); process.exit(1); }

// ── 3. 学生视角（M1~M4 全模块只读）────────────────────────────
log('\n【3. 学生视角】');
await check('个人信息', '/api/auth/me', tk.student);
await check('选课列表', '/api/edu/course', tk.student);
await check('成绩', '/api/edu/score', tk.student);
await check('课表', '/api/edu/timetable', tk.student);
await check('我的请假', '/api/af/leave', tk.student);
await check('公告', '/api/af/notice?page=1&pageSize=5', tk.student);
await check('我的报修', '/api/af/repair', tk.student);
await check('我的宿舍', '/api/dorm?view=my', tk.student);
await check('站内信', '/api/notice/messages', tk.student);
await check('图书检索', '/api/lib/books?page=1&pageSize=5', tk.student);
await check('我的借阅', '/api/lib/loans?scope=mine', tk.student);
await check('失物招领', '/api/lf/items', tk.student);
await check('社团招新', '/api/club/recruit', tk.student);
await check('我的社团预约', '/api/club/recruit?scope=mine', tk.student);
await check('社团申请', '/api/club/apply', tk.student);
await check('论坛版块', '/api/forum/boards', tk.student);
await check('论坛帖子', '/api/forum/threads?page=1&pageSize=5', tk.student);
// 学生邮箱若未开通对外收发，后端按业务返回 43300（正常业务态，非缺陷）
await check('校园邮箱', '/api/mail?page=1&pageSize=5', tk.student, [0, 43300]);

// 报修状态机终态可筛（2026-09-21 新增 status=3）
const r3 = await check('报修按「无法处理」筛选', '/api/af/repair?status=3', tk.admin);

// ── 4. admin 视角 ─────────────────────────────────────────────
log('\n【4. admin 视角】');
const dash = await check('数据驾驶舱', '/api/admin/dashboard', tk.admin);
await check('账号管理', '/api/admin/users?page=1&pageSize=5', tk.admin);
await check('学生管理', '/api/admin/students?page=1&pageSize=5', tk.admin);
await check('系部', '/api/admin/departments', tk.admin);
await check('班级', '/api/admin/classes', tk.admin);
await check('课程与排课', '/api/admin/courses', tk.admin);
await check('宿舍总览', '/api/dorm?view=overview', tk.admin);
await check('全员请假', '/api/af/leave', tk.admin);
await check('全部报修', '/api/af/repair', tk.admin);

// 回归断言：驾驶舱学工线四态齐全（含 2026-09-21 补的 rejected）
const rep = dash?.data?.affairs?.repair;
assert('驾驶舱含报修四态(rejected 已补)',
  rep && typeof rep.pending === 'number' && typeof rep.rejected === 'number',
  rep ? JSON.stringify(rep) : '(缺字段)');

// 回归断言：邮箱密码不得出现在列表接口（2026-09-21 安全修复）
const mb = await check('邮箱列表', '/api/admin/mailbox', tk.admin);
const leaked = (mb?.data?.list || []).filter((r) => r.mail_password !== undefined).length;
assert('邮箱列表不下发明文密码', leaked === 0, `含密码字段的记录 ${leaked} 条`);

// ── 5. counselor 视角 ────────────────────────────────────────
log('\n【5. counselor 视角】');
await check('本院学生名册', '/api/admin/students?page=1&pageSize=5', tk.counselor);
await check('请假审批列表', '/api/af/leave', tk.counselor);
await check('宿舍总览', '/api/dorm?view=overview', tk.counselor);
await check('报修处理列表', '/api/af/repair?status=1', tk.counselor);

// ── 6. teacher 视角 ──────────────────────────────────────────
log('\n【6. teacher 视角】');
await check('我的课程', '/api/edu/teach', tk.teacher);
await check('社团申请审批', '/api/club/apply', tk.teacher);

// ── 7. 鉴权与越权边界 ────────────────────────────────────────
log('\n【7. 鉴权与越权边界】');
const noToken = await call('/api/lib/books');
assert('无 token 访问受保护端点 → 非 0', noToken.json.code !== 0, `code=${noToken.json.code}`);

const stuToAdmin = await call('/api/admin/dashboard', tk.student);
assert('学生访问驾驶舱 → 40301', stuToAdmin.json.code === 40301, `code=${stuToAdmin.json.code}`);

const stuToUsers = await call('/api/admin/users', tk.student);
assert('学生访问账号管理 → 40301', stuToUsers.json.code === 40301, `code=${stuToUsers.json.code}`);

const stuToDorm = await call('/api/dorm?view=overview', tk.student);
assert('学生访问宿舍总览 → 40301', stuToDorm.json.code === 40301, `code=${stuToDorm.json.code}`);

// 两套错误码都表示"令牌被拒"：/api/auth/me 自行解析 → 40100；guard 保护端点 → 40103
const bogus = await call('/api/auth/me', 'garbage.token.value');
assert('伪造 token 被拒（HTTP 401）',
  bogus.http === 401 && [40100, 40103].includes(bogus.json.code),
  `code=${bogus.json.code} http=${bogus.http}`);

// ── 8. 自助改密的安全边界（全部是"不该成功"的调用，不会改动任何账号）──
// 说明：本脚本整体只读，改密的**成功**路径不在 e2e 覆盖范围（会真改密码、破坏演示账号），
// 成功路径由 tests/unit/password-rules.spec.js + 人工一次性验证覆盖。
log('\n【8. 自助改密安全边界】');

const pwNoAuth = await postJson('/api/me/password', null, { oldPassword: 'x', newPassword: 'NewPass456' });
assert('未登录改密 → 40103', pwNoAuth.json.code === 40103, `code=${pwNoAuth.json.code}`);

const pwShort = await postJson('/api/me/password', tk.student, { oldPassword: 'wrong-old', newPassword: 'short' });
assert('新密码过短被拒 → 43701', pwShort.json.code === 43701, `code=${pwShort.json.code} msg=${pwShort.json.message}`);

const pwSame = await postJson('/api/me/password', tk.student, {
  oldPassword: ACCOUNTS.student.password,
  newPassword: ACCOUNTS.student.password,
});
assert('新旧密码相同被拒 → 43702', pwSame.json.code === 43702, `code=${pwSame.json.code}`);

// 错误原密码会被计入"10 分钟 5 次"的失败限流，故 42900 也算被拒（反复跑本脚本时的正常结果）
const pwWrong = await postJson('/api/me/password', tk.student, {
  oldPassword: 'definitely-not-the-password',
  newPassword: 'NewPass456',
});
assert('原密码错误被拒 → 43704/42900',
  [43704, 42900].includes(pwWrong.json.code), `code=${pwWrong.json.code} msg=${pwWrong.json.message}`);

// 反向证明：上面这些失败调用没有误改密码（原 token 仍可用）
const stillOk = await call('/api/auth/me', tk.student);
assert('学生账号未被以上调用影响（原 token 仍有效）', stillOk.json.code === 0, `code=${stillOk.json.code}`);

// ── 汇总 ────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
log('\n─────────────────────');
log(`合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) {
  log(`失败项：${failed.map((f) => f.name).join(' | ')}`);
  process.exit(1);
}
log('ALL-PASS');
