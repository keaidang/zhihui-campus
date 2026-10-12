// scripts/seed-1k-scale.mjs — 将平台用户规模扩充至 1,000 级并闭环生成全套关联业务数据
//
// 作用：
// 1. 扩充用户总量至 ~1,000 人（480 名学生、25 名教师、7 名辅导员）；
// 2. 扩建 16 个教学班并完整分配辅导员与专业院系；
// 3. 严格遵循男女宿舍楼栋硬约束，为全体新学生全量分配床位；
// 4. 当前学期（2026-2027-1）与历史学期（2025-2026-1）选课与成绩正态分布录入；
// 5. 随机生成真实多状态请假单、报修单、图书借还、论坛贴与回复、站内信；
// 6. 100% 保留原有评估极值，与 integrity-check、ai-check 规则强一致。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 4000),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'zhihui_campus',
  ssl: { rejectUnauthorized: true },
  connectTimeout: 25000,
});

const log = (...a) => console.log(...a);

// 确定性随机发生器（mulberry32）
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261012);
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function gauss(mu, sigma, lo, hi) {
  const u = Math.max(1e-9, rand());
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const val = mu + z * sigma;
  return Math.min(hi, Math.max(lo, Math.round(val * 10) / 10));
}

// 批量插入辅助函数
async function insertBatch(sql, rows, size = 150) {
  if (!rows || !rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const [r] = await conn.query(sql, [chunk]);
    n += r.affectedRows || 0;
  }
  return n;
}

// 姓名生成器
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭曾肖田董潘袁蔡蒋余于杜叶程苏魏吕丁任卢钟姜崔范方沈陆金唐'.split('');
const GIVEN1 = '志文嘉雨泽宇浩欣怡俊杰思涵博雅静彤晨曦子墨天翼华清和瑞安宁奕晨子轩若溪浩轩梓豪梦琪一诺宇晨思源沐阳'.split('');
const GIVEN2 = '敏婷强磊军洋艳杰娟涛明超霞平刚桂香兰凤洁梅琳素云莲真环雪荣爱佳香月莺媛瑞凡嘉琼勤珍莉叶璧璐娅晶茜秋珊莎锦青倩婉娴瑾颖露瑶怡婵韵融艺卿澜悦爽茗羽宁欣飘滢筠晓欢芸菲亚宜舒影丽秀娟英华慧巧美娜淑惠雅芝'.split('');
const usedNames = new Set();
function genName() {
  for (let i = 0; i < 300; i++) {
    const n = pick(SURNAMES) + (rand() < 0.65 ? pick(GIVEN1) : '') + pick(GIVEN2);
    if (!usedNames.has(n)) {
      usedNames.add(n);
      return n;
    }
  }
  return pick(SURNAMES) + pick(GIVEN2);
}

const DEFAULT_PWD_HASH = bcrypt.hashSync('Zhihui@2026', 10);
const TERM = '2026-2027-1';
const TERM_HISTORY = '2025-2026-1';

async function main() {
  log('============================================================');
  log('🚀 开始执行 1k 级规模真实业务数据生成与补齐');
  log('============================================================\n');

  // 1. 读取基础学院与角色
  const [depts] = await conn.query('SELECT id, code, name FROM sys_department WHERE id BETWEEN 1 AND 6 ORDER BY id');
  const [roles] = await conn.query('SELECT id, code FROM sys_role');
  const roleMap = Object.fromEntries(roles.map((r) => [r.code, r.id]));

  // 检查是否已有学生
  const [stuCheck] = await conn.query("SELECT COUNT(*) AS n FROM sys_user WHERE username = 'student401'");
  const hasCreatedUsers = Number(stuCheck[0]?.n || 0) > 0;

  if (!hasCreatedUsers) {
    log(`[阶段 1/8] 创建 7 名新辅导员并扩建 16 个全新自然班级...`);
    const counselorRows = [];
    const counselorRoles = [];
    const counselorUsernames = [];
    for (let i = 9; i <= 15; i++) {
      const uname = `counselor${String(i).padStart(2, '0')}`;
      const uno = `C2026${String(i).padStart(4, '0')}`;
      const realName = genName();
      const dept = pick(depts);
      counselorRows.push([
        uname,
        DEFAULT_PWD_HASH,
        realName,
        `counselor${i}@campus.edu.cn`,
        `138${String(randInt(10000000, 99999999))}`,
        1,
        uno,
        dept.id,
        `${uname}@qb.edu.cn`,
        1,
        1,
        rand() < 0.5 ? 1 : 2,
      ]);
      counselorUsernames.push(uname);
    }
    await insertBatch(
      'INSERT INTO sys_user (username, password_hash, real_name, email, phone, status, user_no, dept_id, campus_email, mail_enabled, email_verified, gender) VALUES ?',
      counselorRows,
    );
    const [counselorUsers] = await conn.query(
      'SELECT id, username, dept_id FROM sys_user WHERE username IN (?)',
      [counselorUsernames],
    );
    for (const c of counselorUsers) {
      counselorRoles.push([c.id, roleMap.counselor]);
    }
    await insertBatch('INSERT INTO sys_user_role (user_id, role_id) VALUES ?', counselorRoles);
    log(`  ✅ 7 名新辅导员入库成功 (counselor09 ~ counselor15)`);

    const [allCounselors] = await conn.query(
      `SELECT u.id, u.dept_id FROM sys_user u
         JOIN sys_user_role ur ON ur.user_id = u.id
        WHERE ur.role_id = ?`,
      [roleMap.counselor],
    );
    const counselorsByDept = {};
    for (const c of allCounselors) {
      if (!counselorsByDept[c.dept_id]) counselorsByDept[c.dept_id] = [];
      counselorsByDept[c.dept_id].push(c.id);
    }

    const classDefs = [
      { name: '计算机 2501 班', deptId: 1, grade: 2025 },
      { name: '计算机 2502 班', deptId: 1, grade: 2025 },
      { name: '计算机 2604 班', deptId: 1, grade: 2026 },
      { name: '软件工程 2501 班', deptId: 2, grade: 2025 },
      { name: '软件工程 2502 班', deptId: 2, grade: 2025 },
      { name: '软件工程 2603 班', deptId: 2, grade: 2026 },
      { name: '电子信息 2501 班', deptId: 3, grade: 2025 },
      { name: '电子信息 2502 班', deptId: 3, grade: 2025 },
      { name: '电子信息 2603 班', deptId: 3, grade: 2026 },
      { name: '经管 2501 班', deptId: 4, grade: 2025 },
      { name: '经管 2502 班', deptId: 4, grade: 2025 },
      { name: '经管 2604 班', deptId: 4, grade: 2026 },
      { name: '外语 2501 班', deptId: 5, grade: 2025 },
      { name: '外语 2502 班', deptId: 5, grade: 2025 },
      { name: '机械 2501 班', deptId: 6, grade: 2025 },
      { name: '机械 2502 班', deptId: 6, grade: 2025 },
    ];
    const newClassRows = [];
    for (const c of classDefs) {
      const cId = pick(counselorsByDept[c.deptId] || [allCounselors[0].id]);
      newClassRows.push([c.deptId, c.name, c.grade, cId]);
    }
    await insertBatch(
      'INSERT INTO sys_class (dept_id, name, grade, counselor_id) VALUES ?',
      newClassRows,
    );
    log(`  ✅ 16 个全新自然班级创建完毕，已绑定所属院系与辅导员`);

    log(`\n[阶段 2/8] 创建 25 名新专任教师并分配教研学院...`);
    const teacherRows = [];
    const teacherRoles = [];
    const teacherUsernames = [];
    for (let i = 41; i <= 65; i++) {
      const uname = `teacher${i}`;
      const uno = `T2026${String(i).padStart(4, '0')}`;
      const realName = genName();
      const dept = pick(depts);
      teacherRows.push([
        uname,
        DEFAULT_PWD_HASH,
        realName,
        `${uname}@campus.edu.cn`,
        `139${String(randInt(10000000, 99999999))}`,
        1,
        uno,
        dept.id,
        `${uname}@qb.edu.cn`,
        1,
        1,
        rand() < 0.5 ? 1 : 2,
      ]);
      teacherUsernames.push(uname);
    }
    await insertBatch(
      'INSERT INTO sys_user (username, password_hash, real_name, email, phone, status, user_no, dept_id, campus_email, mail_enabled, email_verified, gender) VALUES ?',
      teacherRows,
    );
    const [teacherUsers] = await conn.query(
      'SELECT id, username, dept_id FROM sys_user WHERE username IN (?)',
      [teacherUsernames],
    );
    for (const t of teacherUsers) {
      teacherRoles.push([t.id, roleMap.teacher]);
    }
    await insertBatch('INSERT INTO sys_user_role (user_id, role_id) VALUES ?', teacherRoles);
    log(`  ✅ 25 名新教师创建完毕 (teacher41 ~ teacher65)`);

    log(`\n[阶段 3/8] 创建 480 名新学生 (student401 ~ student880)，按班级分配...`);
    const [createdClasses] = await conn.query(
      'SELECT id, name, dept_id, grade, counselor_id FROM sys_class WHERE name IN (?)',
      [classDefs.map((c) => c.name)],
    );
    const studentRows = [];
    const studentRoles = [];
    const studentUsernames = [];
    let currentClassIdx = 0;
    for (let i = 401; i <= 880; i++) {
      const uname = `student${i}`;
      const uno = `2026${String(i).padStart(4, '0')}`;
      const realName = genName();
      const cls = createdClasses[currentClassIdx % createdClasses.length];
      currentClassIdx++;
      const gender = i % 2 === 1 ? 1 : 2;
      studentRows.push([
        uname,
        DEFAULT_PWD_HASH,
        realName,
        `${uname}@campus.edu.cn`,
        `135${String(randInt(10000000, 99999999))}`,
        1,
        uno,
        cls.dept_id,
        cls.id,
        `${uname}@qb.edu.cn`,
        1,
        1,
        gender,
      ]);
      studentUsernames.push(uname);
    }
    await insertBatch(
      'INSERT INTO sys_user (username, password_hash, real_name, email, phone, status, user_no, dept_id, class_id, campus_email, mail_enabled, email_verified, gender) VALUES ?',
      studentRows,
    );
    const [newStudents] = await conn.query(
      'SELECT id, username, real_name, gender, dept_id, class_id FROM sys_user WHERE username IN (?) ORDER BY id',
      [studentUsernames],
    );
    for (const s of newStudents) {
      studentRoles.push([s.id, roleMap.student]);
    }
    await insertBatch('INSERT INTO sys_user_role (user_id, role_id) VALUES ?', studentRoles);
    log(`  ✅ 480 名新学生入库成功，每班分配 30 人，男女各 240 人严格均衡`);
  } else {
    log(`ℹ 用户与班级已就绪，直接读取 480 名新增学生列表...`);
  }

  // 读取全体新学生
  const [newStudents] = await conn.query(
    `SELECT u.id, u.username, u.real_name, u.gender, u.dept_id, u.class_id
       FROM sys_user u
      WHERE u.username >= 'student401' AND u.username <= 'student880'
      ORDER BY u.id`,
  );
  log(`  当前处理学生数: ${newStudents.length} 名`);

  // 4. 分配宿舍床位
  log(`\n[阶段 4/8] 检查并分配新学生宿舍床位（男进男栋、女进女栋，一床一人）...`);
  const [existingAssignments] = await conn.query(
    'SELECT user_id FROM dorm_assignment WHERE user_id IN (?)',
    [newStudents.map((s) => s.id)],
  );
  const assignedSet = new Set(existingAssignments.map((a) => a.user_id));
  const unassignedStudents = newStudents.filter((s) => !assignedSet.has(s.id));

  if (unassignedStudents.length > 0) {
    const maleStudents = unassignedStudents.filter((s) => s.gender === 1);
    const femaleStudents = unassignedStudents.filter((s) => s.gender === 2);

    async function assignDormForGender(students, wantGender) {
      if (!students.length) return;
      const [rooms] = await conn.query(
        `SELECT r.id, r.capacity, r.occupied
           FROM dorm_room r
           JOIN dorm_building b ON b.id = r.building_id
          WHERE b.gender = ? AND r.status = 1
          ORDER BY (r.occupied / r.capacity) DESC, r.id`,
        [wantGender],
      );
      const memRooms = rooms.map((r) => ({
        id: r.id,
        capacity: r.capacity,
        occupied: Number(r.occupied),
        dirty: false,
      }));
      const assignments = [];
      let rIdx = 0;
      for (const stu of students) {
        while (rIdx < memRooms.length && memRooms[rIdx].occupied >= memRooms[rIdx].capacity) {
          rIdx++;
        }
        if (rIdx >= memRooms.length) {
          throw new Error(`床位容量不足：${wantGender} 宿舍满员`);
        }
        const room = memRooms[rIdx];
        assignments.push([
          room.id,
          stu.id,
          room.occupied + 1,
          new Date(Date.now() - randInt(30, 90) * 86400000),
        ]);
        room.occupied += 1;
        room.dirty = true;
      }
      await insertBatch(
        'INSERT INTO dorm_assignment (room_id, user_id, bed_no, check_in_at) VALUES ?',
        assignments,
      );
      for (const room of memRooms.filter((r) => r.dirty)) {
        await conn.query('UPDATE dorm_room SET occupied = ? WHERE id = ?', [room.occupied, room.id]);
      }
    }

    await assignDormForGender(maleStudents, 'male');
    await assignDormForGender(femaleStudents, 'female');
    log(`  ✅ ${unassignedStudents.length} 名学生宿舍全量分配完成（男女分栋硬不变量 100% 达成）`);
  } else {
    log(`  ℹ 学生宿舍床位已分配，跳过。`);
  }

  // 5. 课程选课与成绩
  log(`\n[阶段 5/8] 检查并为新学生生成当前学期在选课程与历史学期成绩...`);
  const [existingElects] = await conn.query(
    'SELECT student_id FROM edu_elect WHERE student_id IN (?) AND term = ?',
    [newStudents.map((s) => s.id), TERM],
  );
  const electSet = new Set(existingElects.map((e) => e.student_id));
  const unelectedStudents = newStudents.filter((s) => !electSet.has(s.id));

  if (unelectedStudents.length > 0) {
    const [currentClasses] = await conn.query(
      'SELECT id, capacity, enrolled FROM edu_class WHERE term = ? AND status = 1',
      [TERM],
    );
    await conn.query('UPDATE edu_class SET capacity = capacity + 50 WHERE term = ? AND status = 1', [TERM]);

    const currentElectRows = [];
    for (const stu of unelectedStudents) {
      const courseCount = randInt(4, 6);
      const chosen = new Set();
      while (chosen.size < courseCount) {
        chosen.add(pick(currentClasses).id);
      }
      for (const classId of chosen) {
        currentElectRows.push([classId, stu.id, TERM, 1, null, null]);
      }
    }
    await insertBatch(
      'INSERT INTO edu_elect (class_id, student_id, term, status, score, grade) VALUES ?',
      currentElectRows,
    );
    await conn.query(
      `UPDATE edu_class c
          SET c.enrolled = (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status = 1)
        WHERE c.term = ?`,
      [TERM],
    );
    log(`  ✅ 当前学期选课：新增 ${currentElectRows.length} 条在选记录 (score=NULL, status=1)`);

    // 历史学期成绩
    const [historyClasses] = await conn.query(
      'SELECT id, course_id FROM edu_class WHERE term = ?',
      [TERM_HISTORY],
    );
    const gradeOf = (v) => (v >= 90 ? '优秀' : v >= 80 ? '良好' : v >= 70 ? '中等' : v >= 60 ? '及格' : '不及格');
    const historyElectRows = [];
    for (const stu of unelectedStudents) {
      const courseCount = randInt(5, 7);
      const chosen = new Set();
      while (chosen.size < courseCount) {
        chosen.add(pick(historyClasses).id);
      }
      for (const classId of chosen) {
        const score = gauss(80, 5, 70, 92);
        historyElectRows.push([classId, stu.id, TERM_HISTORY, 2, score, gradeOf(score)]);
      }
    }
    await insertBatch(
      'INSERT INTO edu_elect (class_id, student_id, term, status, score, grade) VALUES ?',
      historyElectRows,
    );
    await conn.query(
      `UPDATE edu_class c
          SET c.enrolled = (SELECT COUNT(*) FROM edu_elect e WHERE e.class_id = c.id AND e.status = 2)
        WHERE c.term = ?`,
      [TERM_HISTORY],
    );
    log(`  ✅ 历史学期成绩：新增 ${historyElectRows.length} 条已出分记录 (正态分布，严守极值不变量)`);
  } else {
    log(`  ℹ 选课与成绩记录已就绪，跳过。`);
  }

  // 6. 请假单与报修单
  log(`\n[阶段 6/8] 检查并补齐学工请假审批单与后勤报修工单...`);
  const [existingLeaves] = await conn.query(
    'SELECT COUNT(*) AS n FROM af_leave WHERE student_id IN (?)',
    [newStudents.map((s) => s.id)],
  );
  if (Number(existingLeaves[0]?.n || 0) === 0) {
    const leaveReasons = [
      { type: '事假', reason: '家中有急事需回家处理，已提前与班长知会' },
      { type: '事假', reason: '考驾照科目三路考，需请假半天' },
      { type: '事假', reason: '回家参加直系亲属婚礼，已向辅导员说明' },
      { type: '病假', reason: '突发急性肠胃炎，前往校医院门诊开药输液' },
      { type: '病假', reason: '重度流行性感冒发烧 38.5 度，在宿舍卧床休养' },
      { type: '病假', reason: '智齿严重发炎剧痛，需前往口腔医院门诊处理' },
      { type: '公假', reason: '代表学院参加第十四届省大学生程序设计竞赛集训' },
      { type: '公假', reason: '校艺术团骨干成员，参加校庆演出全天联调彩排' },
    ];
    const leaveRows = [];
    const pickedLeaveStudents = newStudents.slice(0, 180);
    for (const stu of pickedLeaveStudents) {
      const r = pick(leaveReasons);
      const status = pick([0, 1, 1, 1, 2, 3]);
      const daysAgo = randInt(1, 40);
      const startAt = new Date(Date.now() - daysAgo * 86400000);
      const endAt = new Date(startAt.getTime() + randInt(1, 3) * 86400000);
      const backAt = status === 3 ? endAt : null;
      leaveRows.push([stu.id, stu.dept_id, r.type, r.reason, startAt, endAt, status, backAt, startAt]);
    }
    await insertBatch(
      'INSERT INTO af_leave (student_id, dept_id, type, reason, start_at, end_at, status, back_at, created_at) VALUES ?',
      leaveRows,
    );
    log(`  ✅ 请假单据：新增 ${leaveRows.length} 笔真实请假流转`);
  } else {
    log(`  ℹ 请假单据已就绪，跳过。`);
  }

  // 报修单独立检查与插入
  const [existingRepairs] = await conn.query(
    'SELECT COUNT(*) AS n FROM af_repair WHERE user_id IN (?)',
    [newStudents.map((s) => s.id)],
  );
  if (Number(existingRepairs[0]?.n || 0) === 0) {
    const repairPresets = [
      { cat: '水电', desc: '卫生间洗手台水龙头下水缓慢且渗水，需要维修师傅检修', locPrefix: '宿舍洗手台' },
      { cat: '水电', desc: '宿舍 4 号床上方日光灯管频繁闪烁且有嗡嗡异响', locPrefix: '宿舍天花板' },
      { cat: '水电', desc: '浴室花洒出水软管接头处开裂喷水，无法正常淋浴', locPrefix: '宿舍浴室' },
      { cat: '家具', desc: '阳台推拉门滑轨严重受阻难以拉动，疑似滚轮脱位', locPrefix: '阳台推拉门' },
      { cat: '家具', desc: '3 号床位配套书桌抽屉滑轨损坏，抽屉掉落', locPrefix: '书桌' },
      { cat: '网络', desc: '寝室墙面校园网网线水晶头插口松动，频繁掉线', locPrefix: '宿舍网线接口' },
      { cat: '门锁', desc: '宿舍大门防盗锁锁芯转动生涩，钥匙有时插拔困难', locPrefix: '宿舍门锁' },
      { cat: '其他', desc: '寝室窗外空调外机排水管松动敲打窗框，噪音较大', locPrefix: '空调外机' },
    ];
    const repairRows = [];
    const [studentDorms] = await conn.query(
      `SELECT da.user_id, b.name AS b_name, r.room_no
         FROM dorm_assignment da
         JOIN dorm_room r ON r.id = da.room_id
         JOIN dorm_building b ON b.id = r.building_id
        WHERE da.user_id IN (?)`,
      [newStudents.map((s) => s.id)],
    );
    const dormByUserId = Object.fromEntries(studentDorms.map((d) => [d.user_id, `${d.b_name}${d.room_no}室`]));
    const pickedRepairStudents = newStudents.slice(100, 220);
    for (const stu of pickedRepairStudents) {
      const loc = dormByUserId[stu.id] || '宿舍楼';
      const p = pick(repairPresets);
      const status = pick([0, 1, 2, 2, 2, 3]);
      const remark = status === 2 ? '师傅已上门完成检修并更换配件，经同学验收合格' : status === 3 ? '非校内公共设施维修范围' : '';
      const createdAt = new Date(Date.now() - randInt(1, 30) * 86400000);
      repairRows.push([stu.id, `${loc} ${p.locPrefix}`, p.cat, p.desc, '13500000000', status, status === 2 ? 1 : null, remark, createdAt]);
    }
    await insertBatch(
      'INSERT INTO af_repair (user_id, location, category, description, contact, status, handler_id, remark, created_at) VALUES ?',
      repairRows,
    );
    log(`  ✅ 报修工单：新增 ${repairRows.length} 笔多类目工单`);
  } else {
    log(`  ℹ 报修工单已就绪，跳过。`);
  }

  // 7. 图书借还、论坛与消息
  log(`\n[阶段 7/8] 检查并补齐图书借还流通、师生论坛与系统消息...`);
  const [existingLoans] = await conn.query(
    'SELECT COUNT(*) AS n FROM lib_loan WHERE user_id IN (?)',
    [newStudents.map((s) => s.id)],
  );
  if (Number(existingLoans[0]?.n || 0) === 0) {
    const [books] = await conn.query('SELECT id, total_copies, available_copies FROM lib_book WHERE total_copies >= 3');
    const loanRows = [];
    const pickedLoanStudents = newStudents.slice(200, 360);
    for (const stu of pickedLoanStudents) {
      const book = pick(books);
      const isReturned = rand() < 0.65;
      const daysAgo = randInt(10, 45);
      const borrowedAt = new Date(Date.now() - daysAgo * 86400000);
      const dueAt = new Date(borrowedAt.getTime() + 30 * 86400000);
      const returnedAt = isReturned ? new Date(borrowedAt.getTime() + randInt(5, 25) * 86400000) : null;
      const status = isReturned ? 1 : 0;
      loanRows.push([book.id, stu.id, status, borrowedAt, dueAt, returnedAt]);
    }
    await insertBatch(
      'INSERT INTO lib_loan (book_id, user_id, status, borrowed_at, due_at, returned_at) VALUES ?',
      loanRows,
    );
    await conn.query(
      `UPDATE lib_book b
          SET b.available_copies = b.total_copies - (
            SELECT COUNT(*) FROM lib_loan l WHERE l.book_id = b.id AND l.returned_at IS NULL
          )`,
    );
    log(`  ✅ 图书借还：新增 ${loanRows.length} 笔记录，藏书余量自动校验闭环`);

    // 论坛帖子
    const [boards] = await conn.query('SELECT id, name FROM forum_board WHERE status = 1');
    const threadPresets = [
      { title: '大二下学期有哪些推荐的通识核心选课？求学长学姐分享避坑指南', content: '求问各位同学，周三晚上的那门艺术欣赏作业多不多？期末考核是开卷考试还是写论文呢？' },
      { title: '【闲置转让】九成新无线降噪耳机和四级备考词汇书，毕业低价出', content: '耳机买来很少使用，箱说全。还有红宝书一套，附送真题听力，有需要的同学随时联系。' },
      { title: '图书馆南侧自习室网络连接非常流畅，点赞后勤信息化建设！', content: '最近去图书馆自习发现新加了千兆 Wi-Fi AP，看网课和查文献完全不卡顿，学习效率翻倍！' },
      { title: '【失物寻物】今天傍晚在第一田径场看台附近遗落一副黑框眼镜', content: '下午在操场跑步时放在看台第二层台阶上，回宿舍才发现遗落了，拾到的同学请联系，非常感谢！' },
      { title: '分享：大学计算机专业课学习资源与开源项目实战经验总结', content: '近期整理了一份关于计算机系统、数据结构与算法的学习路线，适合大一和大二的学弟学妹们参考。' },
      { title: '问一下关于校级创新创业训练计划项目的申报截止时间与要求', content: '请问今年立项答辩主要是看商业计划书还是成果实物 Demo 呢？有指导老师推荐吗？' },
    ];
    const threadRows = [];
    for (let i = 0; i < 24; i++) {
      const t = pick(threadPresets);
      const author = pick(newStudents);
      const board = pick(boards);
      const createdAt = new Date(Date.now() - randInt(1, 20) * 86400000);
      threadRows.push([board.id, author.id, `${t.title} #${i + 1}`, t.content, '', 0, '', '', 0, 0, 1, 0, 2, createdAt]);
    }
    await insertBatch(
      'INSERT INTO forum_thread (board_id, author_id, title, content, images, is_trade, item_name, contact, pinned, locked, status, review_status, reply_count, created_at) VALUES ?',
      threadRows,
    );
    const [insertedThreads] = await conn.query('SELECT id, author_id FROM forum_thread ORDER BY id DESC LIMIT 24');
    const replyRows = [];
    const replyContents = [
      '感谢学长分享，非常受用！已收藏！',
      '同问，这门课上学期考核是提交小组研讨报告，难度适中。',
      '已私信联系，同学看看站内信～',
      '今天在保卫处看到有人上交了类似的物品，可以去问问看。',
      '顶一下！很有价值的经验总结。',
    ];
    for (const th of insertedThreads) {
      for (let r = 0; r < 2; r++) {
        const replier = pick(newStudents);
        replyRows.push([th.id, replier.id, pick(replyContents), 1, 0, new Date()]);
      }
    }
    await insertBatch(
      'INSERT INTO forum_reply (thread_id, author_id, content, status, review_status, created_at) VALUES ?',
      replyRows,
    );
    log(`  ✅ 校园论坛：新增 24 篇主题讨论与 ${replyRows.length} 条师生互动回复`);

    // 站内信
    const messageRows = [];
    for (const stu of newStudents.slice(0, 120)) {
      messageRows.push([
        1, // admin
        stu.id,
        'notice',
        'system',
        '【迎新通知】智慧校园平台账号与数字迎新提醒',
        '同学你好，欢迎使用清北大学智汇校园一站式服务平台！你的校园邮箱、选课系统与宿舍服务均已就绪。',
        rand() < 0.6 ? new Date() : null,
        new Date(Date.now() - randInt(5, 30) * 86400000),
      ]);
    }
    await insertBatch(
      'INSERT INTO sys_message (sender_id, receiver_id, type, biz, title, content, read_at, created_at) VALUES ?',
      messageRows,
    );
    log(`  ✅ 站内消息：新增 ${messageRows.length} 封迎新与学业提醒信件`);
  } else {
    log(`  ℹ 图书借还、论坛与消息已就绪，跳过。`);
  }

  log(`\n[阶段 8/8] 汇总全库规模与各角色指标...`);
  const [userStat] = await conn.query(
    `SELECT r.name, COUNT(*) AS n
       FROM sys_user u
       JOIN sys_user_role ur ON ur.user_id = u.id
       JOIN sys_role r ON r.id = ur.role_id
      GROUP BY r.name ORDER BY n DESC`,
  );
  const [totalUsers] = await conn.query('SELECT COUNT(*) AS total FROM sys_user');
  const [totalElects] = await conn.query('SELECT COUNT(*) AS total FROM edu_elect');
  const [totalLeaves] = await conn.query('SELECT COUNT(*) AS total FROM af_leave');
  const [totalRepairs] = await conn.query('SELECT COUNT(*) AS total FROM af_repair');
  const [totalLoans] = await conn.query('SELECT COUNT(*) AS total FROM lib_loan');
  const [totalDorm] = await conn.query('SELECT COUNT(*) AS total FROM dorm_assignment WHERE check_out_at IS NULL');

  log('\n============================================================');
  log(`🎉 数据扩充圆满完成！全校注册用户总计：${totalUsers[0].total} 人`);
  log('============================================================');
  for (const s of userStat) {
    log(`  · ${s.name.padEnd(8)}: ${s.n} 人`);
  }
  log(`  · 在住床位总数: ${totalDorm[0].total} 人 (男女分栋)`);
  log(`  · 全校选课记录: ${totalElects[0].total} 条 (含本学期在选与往年成绩)`);
  log(`  · 学工请假单据: ${totalLeaves[0].total} 笔`);
  log(`  · 后勤设施报修: ${totalRepairs[0].total} 笔`);
  log(`  · 图书借还记录: ${totalLoans[0].total} 笔`);
  log('============================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ 执行失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await conn.end();
    process.exit(0);
  });
