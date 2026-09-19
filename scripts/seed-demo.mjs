// scripts/seed-demo.mjs — 演示数据批量生成（幂等：重复执行自动跳过已存在数据）
// 生成：40 名教师、8 名辅导员、10 名校领导、400 名学生（共 14 个班级，每班 20~40 人）
// 附带：课程库扩充 + 排课（教学班）+ 学生批量选课，让课表/选课/名册等管理功能有真实数据
// 用法：node scripts/seed-demo.mjs   （读取项目根目录 .env 连接 TiDB）
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

let conn = null;
for (let i = 0; i < 8 && !conn; i++) {
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: +process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: true },
      connectTimeout: 20000,
    });
  } catch (e) {
    console.log(`连接失败（第 ${i + 1} 次）：${e.code || e.message}，8s 后重试…`);
    await new Promise((s) => setTimeout(s, 8000));
  }
}
if (!conn) { console.error('多次重试后仍无法连接数据库'); process.exit(1); }

const TERM = '2026-2027-1';
const DEFAULT_PWD = 'Zhihui@2026';
const PASSWORD_HASH = bcrypt.hashSync(DEFAULT_PWD, 10);
const VALID_UNTIL = '2027-07-31 00:00:00';

// ---------- 姓名生成 ----------
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭曾肖田董潘袁蔡蒋余于杜叶程苏魏吕丁任卢'.split('');
const GIVEN1 = '志文嘉雨泽宇浩欣怡俊杰思涵博雅静彤晨曦子墨天翼华清和瑞安宁'.split('');
const GIVEN2 = '敏婷强磊军洋艳杰娟涛明超霞平刚桂香兰凤洁梅琳素云莲真环雪荣爱佳霞香月莺媛艳瑞凡佳嘉琼勤珍贞莉桂娣叶璧璐娅琦晶妍茜秋珊莎锦黛青倩婉娴瑾颖露瑶怡婵雁蓓纨仪荷丹蓉眉君琴蕊薇菁梦岚苑婕馨瑗琰韵融园艺咏卿聪澜纯毓悦昭冰爽琬茗羽希宁欣飘育滢馥筠柔竹霭凝晓欢霄枫芸菲寒伊亚宜可姬舒影荔枝思丽秀娟英华慧巧美娜静淑惠珠翠雅芝'.split('');
const usedNames = new Set();
function genName() {
  for (let i = 0; i < 200; i++) {
    const n = SURNAMES[(Math.random() * SURNAMES.length) | 0] +
      (Math.random() < 0.7 ? GIVEN1[(Math.random() * GIVEN1.length) | 0] : '') +
      GIVEN2[(Math.random() * GIVEN2.length) | 0];
    if (!usedNames.has(n)) { usedNames.add(n); return n; }
  }
  return '师生' + Math.random().toString(36).slice(2, 6);
}
const phone = () => '1' + '3589'[(Math.random() * 4) | 0] + String(Math.random()).slice(2, 11);

// ---------- 基础数据 ----------
const [depts] = await conn.query('SELECT id, code, name FROM sys_department WHERE status = 1 ORDER BY sort, id');
const [roles] = await conn.query('SELECT id, code FROM sys_role');
const ROLE = Object.fromEntries(roles.map((r) => [r.code, r.id]));
const deptByCode = Object.fromEntries(depts.map((d) => [d.code, d]));
console.log('院系:', depts.map((d) => `${d.id}:${d.name}`).join(' | '));

// 兼容不同环境系部编码：按名称关键词兜底匹配
const deptOf = (kw) => depts.find((d) => d.name.includes(kw));

const [existUsers] = await conn.query(
  `SELECT u.username FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id WHERE r.code IN ('teacher','student','counselor','leader')`,
);
const have = new Set(existUsers.map((u) => u.username));

const [existClasses] = await conn.query('SELECT id, name, dept_id, counselor_id FROM sys_class');
const classByName = new Map(existClasses.map((c) => [c.name, c]));

/** 批量建用户并绑定角色，返回 username→id */
async function createUsers(list, roleCode) {
  const todo = list.filter((u) => !have.has(u.username));
  if (!todo.length) {
    const [rows] = await conn.query(
      `SELECT id, username FROM sys_user WHERE username IN (${list.map(() => '?').join(',')})`,
      list.map((u) => u.username),
    );
    return Object.fromEntries(rows.map((r) => [r.username, r.id]));
  }
  const values = todo.map((u) => [u.username, PASSWORD_HASH, u.realName, u.userNo, u.deptId ?? null, u.classId ?? null, u.validUntil ?? null]);
  await conn.query(
    `INSERT INTO sys_user (username, password_hash, real_name, user_no, dept_id, class_id, valid_until) VALUES ${todo.map(() => '(?,?,?,?,?,?,?)').join(',')}`,
    values.flat(),
  );
  const [rows] = await conn.query(
    `SELECT id, username FROM sys_user WHERE username IN (${todo.map(() => '?').join(',')})`,
    todo.map((u) => u.username),
  );
  const ids = Object.fromEntries(rows.map((r) => [r.username, r.id]));
  await conn.query(
    `INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES ${todo.map((u) => `(?,?)`).join(',')}`,
    todo.flatMap((u) => [ids[u.username], ROLE[roleCode]]),
  );
  return ids;
}

// ---------- 1. 班级规划（14 个班，每班目标 ~28 人） ----------
// key: [班级名, 院系关键词, 年级]
const CLASS_PLAN = [
  ['计算机 2601 班', '计算机', 2026], ['计算机 2602 班', '计算机', 2026], ['计算机 2603 班', '计算机', 2026],
  ['软件工程 2601 班', '软件工程', 2026], ['软件工程 2602 班', '软件工程', 2026],
  ['电子信息 2601 班', '电子信息', 2026], ['电子信息 2602 班', '电子信息', 2026],
  ['经管 2601 班', '经济管理', 2026], ['经管 2602 班', '经济管理', 2026], ['经管 2603 班', '经济管理', 2026],
  ['外语 2601 班', '外国语', 2026], ['外语 2602 班', '外国语', 2026],
  ['机械 2601 班', '机械', 2026], ['机械 2602 班', '机械', 2026],
];
for (const [name, kw, grade] of CLASS_PLAN) {
  if (classByName.has(name)) continue;
  const d = deptOf(kw);
  const [r] = await conn.query('INSERT INTO sys_class (dept_id, name, grade) VALUES (?, ?, ?)', [d.id, name, grade]);
  classByName.set(name, { id: r.insertId, name, dept_id: d.id, counselor_id: null });
}
console.log(`班级: ${classByName.size} 个`);

// ---------- 2. 教师 40 名（含已有 teacher01） ----------
const teacherList = [];
for (let i = 2; i <= 40; i++) {
  const no = String(i).padStart(2, '0');
  teacherList.push({
    username: `teacher${no}`, realName: genName(), userNo: `T2026${no.padStart(4, '0')}`,
    deptId: depts[i % depts.length].id,
  });
}
const teacherIds = await createUsers(teacherList, 'teacher');
// 补上已有的 teacher01
{
  const [rows] = await conn.query("SELECT id FROM sys_user WHERE username = 'teacher01'");
  if (rows[0]) teacherIds['teacher01'] = rows[0].id;
}
console.log(`教师: ${Object.keys(teacherIds).length} 名`);

// ---------- 3. 辅导员 8 名（含已有 counselor01），每班指派 1 名（每人带 1~2 班） ----------
const counselorList = [];
for (let i = 2; i <= 8; i++) {
  const no = String(i).padStart(2, '0');
  counselorList.push({ username: `counselor${no}`, realName: genName(), userNo: `C2026${no.padStart(4, '0')}`, deptId: depts[i % depts.length].id });
}
const counselorIds = await createUsers(counselorList, 'counselor');
{
  const [rows] = await conn.query("SELECT id FROM sys_user WHERE username = 'counselor01'");
  if (rows[0]) counselorIds['counselor01'] = rows[0].id;
}
const counselorUsernames = Object.keys(counselorIds);
let ci = 0;
const classCounselor = {}; // 班级名 → username
for (const [name] of CLASS_PLAN) {
  classCounselor[name] = counselorUsernames[ci % counselorUsernames.length];
  ci++;
}
for (const [name, uname] of Object.entries(classCounselor)) {
  const c = classByName.get(name);
  if (!c || c.counselor_id === counselorIds[uname]) continue;
  await conn.query('UPDATE sys_class SET counselor_id = ? WHERE id = ?', [counselorIds[uname], c.id]);
  c.counselor_id = counselorIds[uname];
}
console.log(`辅导员: ${counselorUsernames.length} 名，已全部指派到班`);

// ---------- 4. 校领导 10 名（分配到各院系，不带班） ----------
const leaderList = [];
for (let i = 1; i <= 10; i++) {
  const no = String(i).padStart(2, '0');
  leaderList.push({ username: `leader${no}`, realName: genName(), userNo: `L2026${no.padStart(4, '0')}`, deptId: depts[i % depts.length].id });
}
await createUsers(leaderList, 'leader');
console.log('校领导: 10 名');

// ---------- 5. 学生 400 名（新 student04~student403，续编学号），分入 14 班 ----------
const CLASS_SIZE_TARGET = 28; // 14 班 × 28 ≈ 392，最后一班补足到 400
const classList = CLASS_PLAN.map(([name]) => classByName.get(name));
const need = Math.max(0, 400 - 3); // 已有 student01~03
const studentList = [];
let seq = 4;
for (let i = 0; i < need; i++) {
  const cls = classList[i % classList.length];
  const no4 = String(seq).padStart(3, '0');
  studentList.push({
    username: `student${no4}`,
    realName: genName(),
    userNo: `2026${String(1000 + seq)}`,
    deptId: cls.dept_id,
    classId: cls.id,
    validUntil: VALID_UNTIL,
  });
  seq++;
}
const studentIds = await createUsers(studentList, 'student');
console.log(`学生: 新增 ${Object.keys(studentIds).length} 名`);

// ---------- 6. 课程库扩充（每院系 3~4 门 + 全校公共课） ----------
const COURSE_PLAN = [
  ['CS110', '计算机导论', 1, 3.0, 48], ['CS220', '数据库系统', 1, 3.5, 56], ['CS230', '计算机网络', 1, 3.5, 56],
  ['SE210', '面向对象程序设计', 2, 3.0, 48], ['SE220', '软件测试与质量', 2, 2.5, 40], ['SE310', 'Web 应用开发', 2, 3.0, 48],
  ['EI110', '电路分析基础', 3, 4.0, 64], ['EI220', '信号与系统', 3, 3.5, 56], ['EI310', '嵌入式系统', 3, 3.0, 48],
  ['EM110', '微观经济学', 4, 3.0, 48], ['EM210', '管理学原理', 4, 2.5, 40], ['EM310', '市场营销学', 4, 2.5, 40],
  ['FL110', '英语视听说', 5, 2.0, 32], ['FL220', '翻译理论与实践', 5, 2.5, 40], ['FL310', '商务英语', 5, 2.0, 32],
  ['ME110', '工程制图', 6, 3.0, 48], ['ME220', '机械设计基础', 6, 3.5, 56], ['ME310', '数控技术', 6, 3.0, 48],
  ['GE010', '大学物理', 4, 3.5, 56], ['GE020', '中国特色社会主义理论实践', 4, 2.0, 32], ['GE030', '心理健康与生涯规划', 4, 1.5, 24],
];
for (const [code, name, deptNo, credit, hours] of COURSE_PLAN) {
  await conn.query(
    'INSERT IGNORE INTO edu_course (code, name, credit, hours, dept_id) VALUES (?, ?, ?, ?, ?)',
    [code, name, credit, hours, depts[deptNo - 1].id],
  );
}
console.log(`课程库: ${COURSE_PLAN.length} 门新增（含既有 6 门共 ${6 + COURSE_PLAN.length} 门）`);

// ---------- 7. 排课：每门课程 1~2 个教学班，教师从本院系抽取，时段/教室不冲突 ----------
const [courses] = await conn.query('SELECT id, code, name, dept_id FROM edu_course WHERE status = 1');
const [teachers] = await conn.query(
  `SELECT u.id, u.dept_id FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id
    WHERE r.code = 'teacher' AND u.status = 1 AND u.dept_id IS NOT NULL`,
);
const teachersByDept = {};
for (const t of teachers) (teachersByDept[t.dept_id] ||= []).push(t.id);

const [existEduClass] = await conn.query('SELECT course_id, teacher_id, week_day, section FROM edu_class WHERE term = ?', [TERM]);
const slotUsed = new Set(existEduClass.map((x) => `${x.course_id}|${x.teacher_id}|${x.week_day}|${x.section}`));
const roomUsed = new Set(existEduClass.map((x) => `${x.week_day}|${x.section}|${x.classroom}`));
const SECTIONS = ['1-2节', '3-4节', '5-6节', '7-8节', '9-10节'];
const BUILDINGS = ['教学楼', '实验楼', '综合楼'];

let scheduled = 0;
let teacherSeq = {};
for (const c of courses) {
  const pool = teachersByDept[c.dept_id] || teachers.map((t) => t.id);
  const n = 1 + ((scheduled + c.id) % 2); // 每门课 1~2 个教学班
  for (let k = 0; k < n; k++) {
    teacherSeq[c.id] = (teacherSeq[c.id] || -1) + 1;
    const tid = pool[(c.id * 7 + k * 3) % pool.length];
    // 找一个空闲时段
    let placed = false;
    for (let tries = 0; tries < 40 && !placed; tries++) {
      const day = 1 + ((c.id + k * 2 + tries) % 5); // 周一~周五
      const sec = SECTIONS[(c.id + k + tries) % SECTIONS.length];
      const roomNo = 101 + ((c.id * 13 + k * 7) % 40);
      const room = `${BUILDINGS[(c.id + k) % BUILDINGS.length]} ${roomNo}`;
      if (slotUsed.has(`${c.id}|${tid}|${day}|${sec}`) || roomUsed.has(`${day}|${sec}|${room}`)) continue;
      const [dup] = await conn.query(
        'SELECT id FROM edu_class WHERE course_id = ? AND teacher_id = ? AND term = ? AND week_day = ? AND section = ?',
        [c.id, tid, TERM, day, sec],
      );
      if (dup.length) continue;
      const [r] = await conn.query(
        'INSERT INTO edu_class (course_id, teacher_id, term, capacity, week_day, section, classroom, status) VALUES (?, ?, ?, 60, ?, ?, ?, 1)',
        [c.id, tid, TERM, day, sec, room],
      );
      slotUsed.add(`${c.id}|${tid}|${day}|${sec}`);
      roomUsed.add(`${day}|${sec}|${room}`);
      scheduled++;
      placed = true;
    }
  }
}
console.log(`排课: 本学期教学班累计 ${existEduClass.length + scheduled} 个（新增 ${scheduled}）`);

// ---------- 8. 学生选课：每班选本院系课程的教学班 3~4 门 + 公共课 1~2 门 ----------
const eduByDept = {};
{
  const [rows] = await conn.query(
    `SELECT x.id, x.week_day, x.section, c.dept_id, c.code FROM edu_class x JOIN edu_course c ON c.id = x.course_id WHERE x.term = ? AND x.status = 1`,
    [TERM],
  );
  for (const r of rows) (eduByDept[r.dept_id] ||= []).push(r);
}
const geRows = (await conn.query('SELECT c.dept_id FROM edu_course c WHERE c.code LIKE "GE%"'))[0]
  .map((g) => g.dept_id);

let elects = 0;
// 跨行政班共享的容量额度：同一教学班最多被多个班合选，但总数不得超过 capacity（防超员）
const remaining = {};
{
  const [caps] = await conn.query('SELECT id, capacity, COALESCE(enrolled,0) enrolled FROM edu_class WHERE term = ? AND status = 1', [TERM]);
  for (const c of caps) remaining[c.id] = Math.max(0, Number(c.capacity) - Number(c.enrolled));
}
for (const cls of classList) {
  const [students] = await conn.query('SELECT id FROM sys_user WHERE class_id = ? AND status = 1', [cls.id]);
  if (!students.length) continue;
  const deptEdu = (eduByDept[cls.dept_id] || []).filter((x) => !x.code.startsWith('GE'));
  const geEdu = (eduByDept[geRows[0]] || []).concat(eduByDept[geRows[1]] || []);
  // 时段去重 + 容量校验：同班学生选的课不能撞时间，且教学班剩余名额必须够全班
  const pick = [];
  const usedSlots = new Set();
  const tryPick = (pool, want) => {
    for (const x of pool) {
      if (pick.length >= want) break;
      if (pick.some((p) => p.id === x.id)) continue;
      if (usedSlots.has(`${x.week_day}|${x.section}`)) continue;
      if (remaining[x.id] == null || remaining[x.id] < students.length) continue; // 名额不够，跳过
      pick.push(x); usedSlots.add(`${x.week_day}|${x.section}`);
      remaining[x.id] -= students.length;
    }
  };
  tryPick(deptEdu, 4);
  tryPick(geEdu, 5);
  for (const x of pick) {
    const values = students.map((s) => [x.id, s.id, TERM, 1]);
    try {
      await conn.query(
        `INSERT IGNORE INTO edu_elect (class_id, student_id, term, status) VALUES ${values.map(() => '(?,?,?,?)').join(',')}`,
        values.flat(),
      );
      elects += values.length;
    } catch (e) { /* 单班失败不阻塞 */ }
    await conn.query(
      'UPDATE edu_class SET enrolled = (SELECT COUNT(*) FROM edu_elect WHERE class_id = ? AND status IN (1,2)) WHERE id = ?',
      [x.id, x.id],
    );
  }
}
console.log(`选课: 累计写入约 ${elects} 条选课记录`);

// ---------- 汇总 ----------
const [sum] = await conn.query(
  `SELECT (SELECT COUNT(*) FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id WHERE r.code='teacher') teachers,
          (SELECT COUNT(*) FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id WHERE r.code='counselor') counselors,
          (SELECT COUNT(*) FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id WHERE r.code='leader') leaders,
          (SELECT COUNT(*) FROM sys_user u JOIN sys_user_role ur ON ur.user_id=u.id JOIN sys_role r ON r.id=ur.role_id WHERE r.code='student') students,
          (SELECT COUNT(*) FROM sys_class) classes,
          (SELECT COUNT(*) FROM edu_course) courses,
          (SELECT COUNT(*) FROM edu_class WHERE term=?) eduClasses,
          (SELECT COUNT(*) FROM edu_elect WHERE term=?) elects`,
  [TERM, TERM],
);
console.log('--- 全库汇总 ---');
console.log(JSON.stringify(sum[0], null, 1));

const [sizeCheck] = await conn.query(
  `SELECT c.name, c.counselor_id IS NOT NULL has_counselor, (SELECT COUNT(*) FROM sys_user s WHERE s.class_id=c.id AND s.status=1) n
     FROM sys_class c ORDER BY c.id`,
);
console.log('--- 班级规模（应为 20~40 人且都有辅导员） ---');
console.log(sizeCheck.map((r) => `${r.name}:${r.n}人${r.has_counselor ? '' : '【无辅导员!】'}`).join(' | '));

const [overCheck] = await conn.query(
  `SELECT COUNT(*) n FROM edu_class WHERE enrolled > capacity`,
);
console.log(`--- 超员检查：${Number(overCheck[0].n) === 0 ? '✅ 无超员教学班' : '❌ 超员教学班 ' + overCheck[0].n + ' 个'} ---`);

await conn.end();
console.log('✅ 演示数据生成完成。默认密码均为 Zhihui@2026');
