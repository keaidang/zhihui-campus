// scripts/verify-m4.mjs — M4 三模块线上验证
import fs from 'node:fs';
// 口令只放 .env（铁律），E2E_ADMIN_PWD 优先
for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const BASE = 'https://campus.keaidang.com';
const ADMIN_PWD = process.env.E2E_ADMIN_PWD;
const out = [];
const log = (s) => { console.log(s); out.push(s); };

async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`登录失败 ${username}: ${j.message}`);
  return j.data.accessToken;
}
const get = (path, token) => fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const post = (path, body, token) => fetch(BASE + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
}).then((r) => r.json());

try {
  // 1. 登录
  const admin = await login('admin', ADMIN_PWD);
  const stu = await login('student004', 'Zhihui@2026');
  log('1 登录: admin ✓ student004 ✓');

  // 2. 驾驶舱
  const dash = await get('/api/admin/dashboard', admin);
  log(`2 驾驶舱(admin): code=${dash.code} 学生=${dash.data?.users?.students} 课程=${dash.data?.edu?.courses} 床位=${dash.data?.dorm?.bedsUsed}/${dash.data?.dorm?.bedsTotal} 在借=${dash.data?.life?.loansActive}`);
  const dashStu = await get('/api/admin/dashboard', stu);
  log(`2b 驾驶舱(学生越权): code=${dashStu.code}（期望 40301）`);

  // 3. 宿舍
  const my = await get('/api/dorm?view=my', stu);
  log(`3 我的宿舍: code=${my.code} 宿舍=${my.data?.dorm ? `${my.data.dorm.buildingName} ${my.data.dorm.roomNo} ${my.data.dorm.bedNo}号床` : '未分配'} 室友=${my.data?.roommates?.length}人`);
  const ovStu = await get('/api/dorm?view=overview', stu);
  log(`3b 宿舍总览(学生越权): code=${ovStu.code}（期望 40301）`);
  const ov = await get('/api/dorm?view=overview', admin);
  log(`3c 宿舍总览(admin): code=${ov.code} 楼栋=${ov.data?.buildings?.length} 房间=${ov.data?.rooms?.length}`);
  const unStu = await get('/api/dorm?view=students', admin);
  log(`3d 未住宿学生: code=${unStu.code} 数量=${unStu.data?.list?.length}`);

  // 4. 站内信：admin 发 → student004 收 → 已读
  const send = await post('/api/notice/messages', { action: 'send', target: 'user', userId: 10144481, title: 'M4 验证消息', content: '这是一条 M4 站内信验证消息，可删除。' }, admin);
  log(`4 admin 发站内信: code=${send.code} msg=${send.message}`);
  const stuMsgs = await get('/api/notice/messages?scope=unread', stu);
  const got = stuMsgs.data?.list?.find((m) => m.title === 'M4 验证消息');
  log(`4b student004 未读: code=${stuMsgs.code} unread=${stuMsgs.data?.unread} 收到验证消息=${got ? '是' : '否'}`);
  if (got) {
    const rd = await post('/api/notice/messages', { action: 'read', id: got.id }, stu);
    const del = await post('/api/notice/messages', { action: 'delete', id: got.id }, stu);
    log(`4c 已读+删除: read=${rd.code} del=${del.code}`);
  }
  const sendStu = await post('/api/notice/messages', { action: 'send', target: 'all', title: 'x', content: 'y' }, stu);
  log(`4d 学生发广播越权: code=${sendStu.code}（期望 40301）`);

  // 5. 报修通知闭环：学生提交 → admin 受理 → 学生收到通知
  const rep = await post('/api/af/repair', { action: 'create', category: '网络', location: '3栋 101（M4验证）', contact: '13800000000', description: 'M4 验证用报修，请忽略' }, stu);
  log(`5 学生提交报修: code=${rep.code} id=${rep.data?.id}`);
  const acc = await post('/api/af/repair', { action: 'accept', id: rep.data?.id, remark: 'M4 验证' }, admin);
  log(`5b admin 受理: code=${acc.code} msg=${acc.message}`);
  const after = await get('/api/notice/messages?scope=unread', stu);
  const notified = after.data?.list?.some((m) => m.biz === 'repair' && m.title.includes('已受理'));
  log(`5c 报修通知自动送达: ${notified ? '是 ✓' : '否 ✗'} unread=${after.data?.unread}`);

  // 6. 请假审批通知（申请 → admin 批 → 收通知）
  const lv = await post('/api/af/leave', { action: 'apply', type: '事假', reason: 'M4 验证请假', startAt: '2026-09-25 08:00', endAt: '2026-09-25 18:00' }, stu);
  log(`6 学生请假: code=${lv.code} id=${lv.data?.leaveId}`);
  if (lv.code === 0) {
    const ap = await post('/api/af/leave', { action: 'approve', leaveId: lv.data.leaveId, opinion: 'M4 验证通过' }, admin);
    const after2 = await get('/api/notice/messages?scope=unread', stu);
    const lvNotified = after2.data?.list?.some((m) => m.biz === 'leave' && m.title.includes('已批准'));
    log(`6b admin 批准: code=${ap.code} 请假通知送达: ${lvNotified ? '是 ✓' : '否 ✗'}`);
    await post('/api/af/leave', { action: 'back', leaveId: lv.data.leaveId }, stu);
  }

  log('\n== M4 线上验证完成 ==');
} catch (e) {
  log(`ERR ${e.message}`);
}
try { fs.mkdirSync(new URL('../working/', import.meta.url), { recursive: true }); fs.writeFileSync(new URL('../working/verify-m4.txt', import.meta.url), out.join('\n')); } catch {}
