// 全站只读冒烟：学生身份覆盖 M1~M3 + 边缘端点，验证方案B改动无回归
const BASE = 'https://campus.keaidang.com';
const results = [];
const log = (s) => console.log(s);

async function check(name, path, token, expect = 0) {
  try {
    const res = await fetch(BASE + path, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const j = await res.json().catch(() => ({}));
    const pass = j.code === expect;
    const extra = j.code === 0 && j.data?.list ? ` count=${j.data.list.length}` :
      j.code === 0 && j.data?.total != null ? ` total=${j.data.total}` : '';
    results.push({ name, pass, code: j.code, http: res.status });
    log(`${pass ? '✅' : '❌'} ${name}: code=${j.code} http=${res.status}${extra}${pass ? '' : ' msg=' + (j.message || '')}`);
    return j;
  } catch (e) {
    results.push({ name, pass: false, code: 'ERR', http: '-' });
    log(`❌ ${name}: EXC ${e.message.slice(0, 80)}`);
    return {};
  }
}

// 1. 健康 + 边缘端点（无鉴权）
await check('健康检查', '/api/health');
await check('边缘统计 KV', '/api/edge/stats');
await check('边缘 KV 诊断', '/api/kv-check');

// 2. 登录（方案B改过：账号维度限流，正常登录应不受影响）
const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'student004', password: 'Zhihui@2026' }),
});
const lj = await login.json().catch(() => ({}));
const okLogin = lj.code === 0;
results.push({ name: '登录', pass: okLogin, code: lj.code, http: login.status });
log(`${okLogin ? '✅' : '❌'} 登录: code=${lj.code} roles=${lj.data?.user?.roles?.join(',') || '-'}`);
if (!okLogin) { log('FATAL: 登录失败，终止'); process.exit(1); }
const tk = lj.data.accessToken;

// 3. M1/M2 教学 & 后勤（学生视角）
await check('选课列表', '/api/edu/course', tk);
await check('成绩', '/api/edu/score', tk);
await check('课表', '/api/edu/timetable', tk);
await check('我的请假', '/api/af/leave', tk);
await check('公告', '/api/af/notice?page=1&pageSize=5', tk);
await check('我的报修', '/api/af/repair', tk);
await check('个人信息', '/api/auth/me', tk);

// 4. M3 五模块（学生视角，只读）
await check('图书检索', '/api/lib/books?page=1&pageSize=5', tk);
await check('我的借阅', '/api/lib/loans?scope=mine', tk);
await check('失物招领', '/api/lf/items', tk);
await check('社团招新', '/api/club/recruit', tk);
await check('我的社团预约', '/api/club/recruit?scope=mine', tk);
await check('社团申请', '/api/club/apply', tk);
await check('论坛版块', '/api/forum/boards', tk);
await check('论坛帖子', '/api/forum/threads?page=1&pageSize=5', tk);
await check('校园邮箱', '/api/mail?page=1&pageSize=5', tk);

// 5. 鉴权边界（无 token 访问受保护端点应 401）
const guard = await fetch(BASE + '/api/lib/books').then((r) => r.json()).catch(() => ({}));
const guardOk = guard.code !== 0;
results.push({ name: '鉴权边界', pass: guardOk, code: guard.code, http: '-' });
log(`${guardOk ? '✅' : '❌'} 鉴权边界: 无token访问 code=${guard.code}（应非0）`);

// 汇总
const fail = results.filter((r) => !r.pass);
log('─────────────────────');
log(`合计 ${results.length} 项，通过 ${results.length - fail.length}，失败 ${fail.length}`);
if (fail.length) { log('失败项: ' + fail.map((f) => f.name).join(', ')); process.exit(1); }
log('ALL-PASS');
