// scripts/seed-m3.mjs — M3 五模块测试数据（幂等：已存在自动跳过）
// 生成：~400 本藏书 / 失物招领 8 条 / 社团申请(2 待审 + 6 已通过带招募) / 论坛 6 板块 ~32 帖 + 回复
// 图片：优先从 picsum.photos 抓取真实图片存入 sys_blob（/api/blob/xx），失败自动生成本地 SVG 占位图
// 用法：node scripts/seed-m3.mjs   （读取项目根目录 .env 连接 TiDB）
import mysql from 'mysql2/promise';
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

const q = async (sql, params) => (await conn.query(sql, params))[0];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const daysAgo = (n, h = 12) => {
  const d = new Date(Date.now() - n * 86400_000);
  d.setHours(h, randInt(0, 59), 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

// ---------- 图片：抓取或生成 ----------
const svgImage = (label, hue) => {
  const h1 = hue % 360;
  const h2 = (hue + 40) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${h1},55%,62%)"/><stop offset="1" stop-color="hsl(${h2},60%,38%)"/>
  </linearGradient></defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <circle cx="520" cy="90" r="130" fill="rgba(255,255,255,0.14)"/>
  <circle cx="110" cy="400" r="90" fill="rgba(255,255,255,0.10)"/>
  <text x="320" y="252" font-family="sans-serif" font-size="40" fill="#fff" text-anchor="middle" font-weight="600">${label}</text>
</svg>`;
};

async function putBlob(bytes, mime) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 16; i++) token += chars[Math.floor(Math.random() * chars.length)];
  await q('INSERT INTO sys_blob (token, mime, size, data, uploader_id) VALUES (?, ?, ?, ?, 0)', [token, mime, bytes.length, bytes]);
  return `/api/blob?token=${token}`;
}

async function fetchImage(label, index) {
  // 先尝试 picsum 真实图片（带 6s 超时），失败生成 SVG
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`https://picsum.photos/seed/campus${index}/640/480`, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 1000) return putBlob(buf, res.headers.get('content-type') || 'image/jpeg');
    }
  } catch { /* 网络不通走 SVG */ }
  return putBlob(Buffer.from(svgImage(label, index * 47)), 'image/svg+xml');
}

// ---------- 1. 图书 ----------
const BOOK_CATS = {
  计算机: { authors: ['Andrew S. Tanenbaum', '陈皓', 'Robert C. Martin', '刘未鹏', 'Martin Kleppmann', '吴军', 'Jon Bentley'], pubs: ['人民邮电出版社', '机械工业出版社', '电子工业出版社', '清华大学出版社'], words: ['深入理解计算机系统', '代码整洁之道', '算法导论', '计算机网络', '操作系统导论', '数据库系统概念', '编译原理', '设计模式', '重构', '编程之美', '程序员修炼之道', 'Linux 命令行与 Shell 脚本', '深入浅出 Node.js', 'Vue.js 设计与实现', 'TCP/IP 详解'] },
  AI: { authors: ['Ian Goodfellow', '李航', '周志华', 'Yoshua Bengio', 'Stuart Russell'], pubs: ['人民邮电出版社', '机械工业出版社', '电子工业出版社'], words: ['深度学习', '统计学习方法', '机器学习', '人工智能：一种现代方法', '神经网络与深度学习', '大模型应用开发实战', '自然语言处理入门', '强化学习导论', '计算机视觉：算法与应用', 'Prompt 工程实践'] },
  金融: { authors: ['本杰明·格雷厄姆', '沃伦·巴菲特', '查理·芒格', '唐朝', '邱国鹭'], pubs: ['机械工业出版社', '中信出版社', '中国经济出版社'], words: ['聪明的投资者', '证券分析', '穷查理宝典', '手把手教你读财报', '投资中最简单的事', '经济学原理', '货币金融学', '漫步华尔街', '期权、期货及其他衍生品', '公司理财'] },
  文学: { authors: ['余华', '莫言', '路遥', '钱钟书', '曹雪芹', '东野圭吾', '马尔克斯'], pubs: ['人民文学出版社', '作家出版社', '南海出版公司', '北京十月文艺出版社'], words: ['活着', '平凡的世界', '围城', '红楼梦', '白夜行', '百年孤独', '许三观卖血记', '丰乳肥臀', '边城', '骆驼祥子'] },
  历史: { authors: ['黄仁宇', '司马迁', '斯塔夫里阿诺斯', '吕思勉', '当年明月'], pubs: ['中华书局', '三联书店', '北京大学出版社'], words: ['万历十五年', '史记', '全球通史', '中国通史', '明朝那些事儿', '大秦帝国', '罗马人的故事', '叫魂', '天朝的崩溃'] },
  科学: { authors: ['史蒂芬·霍金', '比尔·布莱森', '卡尔·萨根', '曹天元'], pubs: ['湖南科学技术出版社', '接力出版社', '中信出版社'], words: ['时间简史', '万物简史', '宇宙', '上帝掷骰子吗', '自私的基因', '昆虫记', '寂静的春天', '人类简史'] },
  艺术: { authors: ['贡布里希', '蒋勋', '宗白华', '朱光潜'], pubs: ['广西美术出版社', '上海人民美术出版社', '北京大学出版社'], words: ['艺术的故事', '写给大家的西方美术史', '美学散步', '谈美', '认识电影', '电影史'] },
  教育: { authors: ['苏霍姆林斯基', '陶行知', '简·尼尔森', '尹建莉'], pubs: ['教育科学出版社', '华东师范大学出版社', '作家出版社'], words: ['给教师的建议', '陶行知教育文集', '正面管教', '好妈妈胜过好老师', '爱的教育', '童年的秘密'] },
  综合: { authors: ['瑞·达利欧', '古典', '李笑来', '卡罗尔·德韦克'], pubs: ['中信出版社', '机械工业出版社'], words: ['原则', '你的生命有什么可能', '把时间当作朋友', '终身成长', '高效能人士的七个习惯', '非暴力沟通', '被讨厌的勇气'] },
};
const AREAS = ['A', 'B', 'C', 'D', 'E'];

async function seedBooks() {
  const [{ n }] = await q('SELECT COUNT(*) n FROM lib_book');
  if (Number(n) > 0) {
    console.log(`图书已有 ${n} 本，跳过`);
    return;
  }
  let idx = 1;
  let isbnBase = 9780000000000n;
  const batch = [];
  for (const [cat, conf] of Object.entries(BOOK_CATS)) {
    for (const w of conf.words) {
      const copies = randInt(2, 8);
      for (let v = 0; v < randInt(1, 3); v++) {
        // 同名多版本（出版社/作者稍作变化），凑到几百本
        const title = v === 0 ? w : `${w}（${rand(['第2版', '修订版', '典藏版', '影印版'])}）`;
        isbnBase += BigInt(randInt(11, 99));
        const loc = `图书馆${randInt(2, 5)}楼${rand(AREAS)}区${String(randInt(1, 40)).padStart(2, '0')}架`;
        batch.push([title, rand(conf.authors), `9787${String(isbnBase).slice(-9)}`, rand(conf.pubs), cat, loc, copies, copies]);
        idx++;
      }
    }
  }
  // 补足到 400+：扩容计算机与 AI 两个方向的变体
  while (batch.length < 420) {
    const conf = BOOK_CATS['计算机'];
    const base = rand(conf.words);
    isbnBase += BigInt(randInt(101, 999));
    const loc = `图书馆${randInt(2, 5)}楼${rand(AREAS)}区${String(randInt(1, 40)).padStart(2, '0')}架`;
    const copies = randInt(2, 8);
    batch.push([`${base}：${rand(['实践篇', '进阶指南', '案例分析', '习题解析', '工程应用'])}`, rand(conf.authors), `9787${String(isbnBase).slice(-9)}`, rand(conf.pubs), '计算机', loc, copies, copies]);
  }
  const values = batch.map(([t, a, i2, p, c, l, tc, ac]) => [t, a, i2, p, c, l, tc, ac]);
  await conn.query(
    'INSERT INTO lib_book (title, author, isbn, publisher, category, location, total_copies, available_copies) VALUES ?',
    [values],
  );
  console.log(`图书：已插入 ${values.length} 本`);
}

// ---------- 2. 失物招领 ----------
async function seedLostFound() {
  const [{ n }] = await q('SELECT COUNT(*) n FROM lf_item');
  if (Number(n) > 0) {
    console.log(`失物招领已有 ${n} 条，跳过`);
    return;
  }
  const counselors = await q(
    `SELECT u.id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id WHERE r.code = 'counselor' LIMIT 1`,
  );
  const publisher = counselors[0]?.id ?? 1;
  const items = [
    ['黑色头戴式耳机', '在图书馆 3 楼自习区 C 座拾获， Sony 黑色，右侧有轻微划痕。存放于学工处办公室。', '13800001111'],
    ['校园卡（张伟）', '二食堂门口拾获 2026 级张伟同学的校园卡一张，请本人携学生证到学工处认领。', '13800001111'],
    ['银色保温杯', '教学楼 A305 教室课桌内拾获，杯身贴有小熊贴纸。', '13800002222'],
    ['蓝色雨伞', '图书馆南门伞架拾获，长柄蓝色雨伞，伞柄挂绳为黄色。', '13800002222'],
    ['白色 AirPods 耳机盒', '操场看台东侧拾获，盒盖内附贴纸，电量约 80%。', '13800003333'],
    ['数学分析教材（第三版）', '教学楼 B201 拾获，书内有大量手写笔记，姓名页写着"李文静"。', '13800003333'],
    ['黑色钱包（内有证件）', '校门口公交站拾获黑色短款钱包，内有身份证与银行卡，请本人速来认领。', '13800004444'],
    ['机械键盘（61 键）', '宿舍区 6 栋活动室拾获，白光轴，键帽为侧刻。', '13800004444'],
  ];
  let i = 1;
  for (const [title, desc, contact] of items) {
    const url = await fetchImage(title.slice(0, 8), 100 + i);
    await q(
      'INSERT INTO lf_item (title, description, images, contact, publisher_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [title, desc, JSON.stringify([url]), contact, publisher, daysAgo(randInt(1, 20), randInt(8, 20))],
    );
    i++;
  }
  console.log('失物招领：已插入 8 条');
}

// ---------- 3. 社团 ----------
async function seedClub() {
  const [{ n }] = await q('SELECT COUNT(*) n FROM club_application');
  if (Number(n) > 0) {
    console.log(`社团申请已有 ${n} 条，跳过`);
    return;
  }
  const students = await q(
    `SELECT u.id, u.real_name FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id
     WHERE r.code = 'student' ORDER BY u.id LIMIT 12`,
  );
  if (students.length < 8) {
    console.log('学生账号不足，跳过社团 seed');
    return;
  }
  const teachers = await q(
    `SELECT u.id FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id
     JOIN sys_role r ON r.id = ur.role_id WHERE r.code = 'teacher' LIMIT 1`,
  );
  const reviewer = teachers[0]?.id ?? 1;

  const clubs = [
    ['AI 兴趣社', '教学楼 A305', '每周三 19:00-20:30', '围绕大模型与 AI 应用的兴趣社团，兼顾入门与进阶。', '第 1 讲：AI 发展现状与大模型原理概览\n第 2 讲：Prompt 工程入门实践\n第 3 讲：用 API 搭建校园问答机器人\n第 4 讲：RAG 与知识库实战\n第 5 讲：AI 绘画与多模态应用\n第 6 讲：成果展示与项目孵化'],
    ['程序设计竞赛队', '机房 402', '每周五 18:30-21:00', '面向 ACM/蓝桥杯等竞赛的训练队，寒暑假集训。', '阶段一：C++ 基础与 STL\n阶段二：数据结构专题\n阶段三：图论 / 动态规划 / 数学\n阶段四：模拟赛与复盘'],
    ['金融投资研习社', '教学楼 B201', '每双周六 14:00-16:00', '财报阅读、行业研究与模拟炒股，理性投资启蒙。', '第 1 期：财报三表入门\n第 2 期：估值方法概览\n第 3 期：行业研究框架\n第 4 期：模拟盘总结'],
    ['摄影社', '艺术楼 105', '每周日 15:00-17:00', '从构图用光到修图调色，记录校园四季。', '第 1 讲：相机与手机摄影基础\n第 2 讲：构图与用光\n第 3 讲：校园外拍实践\n第 4 讲：Lightroom 修图\n第 5 讲：作品评选展'],
    ['羽毛球社', '体育馆 2 楼', '每周二、四 18:00-20:00', '固定球友约球，定期组织社内单双打循环赛。', '常规活动：周二自由约球\n常规活动：周四教学+对抗\n月度：社内排位赛'],
    ['英语角', '外语楼 203', '每周四 19:00-20:00', '口语限时英语角，每周一个话题，外教不定期参与。', 'Week 1: Campus Life\nWeek 2: Technology & AI\nWeek 3: Movies & Music\nWeek 4: Free Talk + 外教点评'],
  ];
  const recruits = [];
  let day = 30;
  for (const [name, location, time, content, outline] of clubs) {
    const proposer = students[randInt(0, students.length - 1)];
    const createdAt = daysAgo(day, 10);
    await q(
      `INSERT INTO club_application (name, location, content, outline, activity_time, proposer_id, status, review_opinion, reviewer_id, reviewed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, '方案完整，同意开展', ?, ?, ?)`,
      [name, location, content, outline, time, proposer.id, reviewer, createdAt, createdAt],
    );
    const [app] = await q('SELECT id FROM club_application WHERE name = ? LIMIT 1', [name]);
    recruits.push({ appId: app.id, name, location, time, content, proposer });
    day -= 4;
  }
  // 2 个待审批申请
  for (const [name, location, time, content, outline] of [
    ['轮滑社', '操场东广场', '每周六 09:00-11:00', '轮滑基础教学与刷街活动，护具齐全。', '第 1 讲：站立与滑行\n第 2 讲：转弯与刹车\n第 3 讲：平花基础\n第 4 讲：集体刷街安全须知'],
    ['辩论队', '行政楼报告厅', '每周一 19:00-21:00', '校辩论队纳新训练，参加市级与省级赛事。', '第 1 讲：立论与质询\n第 2 讲：驳论技巧\n第 3 讲：模拟辩论\n第 4 讲：赛前集训'],
  ]) {
    const proposer = students[randInt(0, students.length - 1)];
    await q(
      'INSERT INTO club_application (name, location, content, outline, activity_time, proposer_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
      [name, location, content, outline, time, proposer.id, daysAgo(2, 14)],
    );
  }
  // 招聘 + 预约
  let i = 1;
  for (const r of recruits) {
    const quota = randInt(15, 40);
    const url = await fetchImage(r.name.slice(0, 6), 300 + i);
    const taken0 = randInt(2, Math.min(8, quota - 2));
    const createdAt = daysAgo(randInt(5, 20), 15);
    await q(
      'INSERT INTO club_recruit (application_id, title, content, images, quota, taken, status, publisher_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      [r.appId, `${r.name} 招募新社员`, `${r.content} 名额有限，预约从速！活动地点：${r.location}，时间：${r.time}。`, JSON.stringify([url]), quota, taken0, r.proposer.id, createdAt],
    );
    const [rec] = await q('SELECT id FROM club_recruit WHERE application_id = ? LIMIT 1', [r.appId]);
    // 为前 taken0 名学生造预约
    const picked = students.slice(0, taken0);
    for (const s of picked) {
      await q('INSERT INTO club_booking (recruit_id, user_id, created_at) VALUES (?, ?, ?)', [rec.id, s.id, daysAgo(randInt(1, 5), randInt(9, 21))]);
    }
    i++;
  }
  console.log('社团：6 个已通过 + 招募与预约，2 个待审批');
}

// ---------- 4. 论坛 ----------
async function seedForum() {
  const [{ n }] = await q('SELECT COUNT(*) n FROM forum_thread');
  if (Number(n) > 0) {
    console.log(`论坛已有 ${n} 帖，跳过`);
    return;
  }
  const users = await q(
    `SELECT u.id, u.real_name FROM sys_user u
     JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id
     WHERE r.code = 'student' ORDER BY u.id LIMIT 20`,
  );
  if (users.length < 5) {
    console.log('学生账号不足，跳过论坛 seed');
    return;
  }
  const boards = await q('SELECT id, name, is_trade FROM forum_board ORDER BY sort');
  const boardByName = Object.fromEntries(boards.map((b) => [b.name, b]));
  const uid = () => rand(users).id;
  const uname = () => rand(users).real_name;

  const threads = [
    // 日常闲谈
    ['日常闲谈', '开学第三周，图书馆的自习位还是这么抢手', '早上 7:40 到图书馆居然只剩负一层有座了……大家都是几点去占座的？有没有什么冷门好去处？', null],
    ['日常闲谈', '食堂二楼新开的麻辣香锅真的绝', '排队 15 分钟，值！微辣已经很够味了，同伴点中辣被辣哭了哈哈哈', null],
    ['日常闲谈', '求推荐宿舍好物', '马上降温了，求推荐床帘、暖手宝、小台灯之类的好物，最好带链接', null],
    ['日常闲谈', '校园卡充值有没有快一点的方式', '每次都在机器前排队，App 充值又提示维护中，大家怎么充的？', null],
    // 计算机
    ['计算机', '整理了一份后端学习路线（附书单）', '从 C 语言 → 数据结构 → 操作系统 → 网络 → 数据库 → 分布式，每阶段配 2 本主书 + 2 本参考，需要的评论区扣 1', null],
    ['计算机', '蓝桥杯倒计时 40 天，组队刷题', '每周三晚机房 402 一起刷历年真题，目前 4 人，缺 1-2 个会 DFS/BFS 的', null],
    ['计算机', '求助：MySQL 索引失效的几种场景', '线上遇到一个慢查询，明明建了索引却走全表扫，只有 OR 条件……还有哪些常见失效场景？', null],
    ['计算机', '你们的项目课都做了什么', '我们组做了个校园二手交易小程序（对，就是论坛交易区的前身），答辩被老师夸了', null],
    ['计算机', '笔记本选购求建议（预算 6k）', '主要写代码 + 轻度游戏，看中了两台，一台屏幕好一台内存大，纠结中', null],
    ['计算机', '分享：把宿舍台式机变成低功耗 NAS 的踩坑记录', '降压超频 + 硬盘休眠 + 内网穿透，一个月电费不到 8 块，教程整理好了', null],
    // AI 前沿
    ['AI 前沿', '用大模型给校园平台写了个选课推荐小助手', '输入兴趣方向和已修课程，输出推荐课表，用了 RAG 挂培养方案 PDF，准确率还不错', null],
    ['AI 前沿', '周志华《机器学习》第 3 章读书笔记', '线性模型那一章的对数几率回归推导整理成脑图了，评论区自取', null],
    ['AI 前沿', '现在做毕设用 AI 辅助代码的边界在哪里？', '老师说不禁止但要能讲清每一行。大家毕设都怎么用 AI 的？', null],
    ['AI 前沿', 'AI 绘画社刊：校园四季插画集', '用 SD + LoRA 训练了校园建筑风格，图在楼层里，求点评', null],
    ['AI 前沿', '论文精读：Attention Is All You Need 十年后', '从原始 Transformer 到如今的稀疏注意力 / MoE，做了个时间线梳理', null],
    // 金融财经
    ['金融财经', '大学生第一只基金应该怎么选？', '定投宽基还是行业主题？我用生活费试了半年，整理了收益对比', null],
    ['金融财经', '读《聪明的投资者》第一章笔记', '「投资与投机的区别」这一节放在今天看依然振聋发聩，摘录 + 感想', null],
    ['金融财经', '银行秋招笔试都考什么', 'EPI + 经济金融 + 英语，分享一下我的复习顺序和题库来源', null],
    ['金融财经', 'ChatGPT 能做财务分析吗？实测', '让它算了三家公司 ROE 拆解，有两家算错了……附我的修正提示词', null],
    ['金融财经', '记账两年的一些数据', '大二到大四每月支出分布，吃饭占 45%，大头居然是书和打印', null],
    // 学习资料
    ['学习资料', '高数（下）期末复习资料合集', '历年卷 + 错题本 + 公式卡，网盘链接 48h 后失效，速取', null],
    ['学习资料', '四六级 600+ 备考时间线', '9 月开始每天 1.5h 的安排表，重点在听力精听和真题二刷', null],
    ['学习资料', '线代速通：三小时过期末', '行列式 / 秩 / 特征值的必考题型与套路总结，图解版', null],
    ['学习资料', '考研 408 全年规划', '数据结构 → 组成原理 → 操作系统 → 网络的先后顺序与每日时间分配', null],
    // 交易集市（is_trade：物品/价格/联系方式）
    ['交易集市', '出 95 新机械键盘（佳达隆黄轴）', '大一买了吃灰，白色 61 键侧刻，附原装线，可小刀', { item: '机械键盘 61 键', price: 129, contact: '微信：qb_2026' }],
    ['交易集市', '考研数学全套资料转让', '张宇 36 讲 + 1000 题 + 历年真题，九成新无笔记', { item: '考研数学资料全套', price: 88, contact: 'QQ：1029384756' },
    ],
    ['交易集市', '自行车 26 寸变速，毕业急出', '骑了一年，刹车刚换，送车锁和打气筒，自提', { item: '26 寸变速自行车', price: 260, contact: '电话：13800005555' }],
    ['交易集市', '出 iPad 第九代 64G 带笔', '上课记笔记神器，配类纸膜和保护壳，电池健康 92%', { item: 'iPad 9 代 + 一代笔', price: 1550, contact: '微信：pad2026sale' }],
    ['交易集市', '收：二手小冰箱（宿舍用）', '想收一台能放饮料的小冰箱，预算 300 内，成色不限能制冷就行', { item: '小冰箱（求购）', price: 300, contact: 'QQ：5647382910' }],
    ['交易集市', '羽毛球拍双拍转让', '尤尼克斯入门双拍 + 球筒 6 个，打了一学期', { item: '羽毛球拍双拍+球', price: 180, contact: '微信：ymq_2026' }],
  ];

  let day = 25;
  let imgIdx = 500;
  for (const [boardName, title, content, trade] of threads) {
    const b = boardByName[boardName];
    if (!b) continue;
    const author = uid();
    const createdAt = daysAgo(day, randInt(8, 21));
    let imgUrl = null;
    if (Math.random() < 0.4 || trade) imgUrl = await fetchImage(title.slice(0, 8), imgIdx++);
    const [ins] = await conn.query(
      `INSERT INTO forum_thread (board_id, author_id, title, content, images, is_trade, item_name, price, contact, pinned, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.id, author, title, content,
        JSON.stringify(imgUrl ? [imgUrl] : []),
        trade ? 1 : 0,
        trade?.item || '',
        trade?.price ?? null,
        trade?.contact || '',
        Math.random() < 0.12 ? 1 : 0,
        createdAt,
      ],
    );
    const tid = ins.insertId;
    // 每帖 1~5 条回复
    const replyN = randInt(1, 5);
    let last = null;
    for (let r = 0; r < replyN; r++) {
      const rc = rand([
        '感谢分享，收藏了！', '同问，蹲一个后续', '楼主可以详细说说吗？', '太真实了哈哈哈', '已私信你～',
        '这个思路学到了', '帮顶，希望更多的人看到', '上学期也遇到过，后来是这么解决的……', '-mark，明天来看',
        '资料求合租网盘！', '建议置顶', '兄弟们冲，名额不多了',
      ]);
      const at = daysAgo(Math.max(0, day - randInt(0, 2)), randInt(9, 22));
      await q('INSERT INTO forum_reply (thread_id, author_id, content, created_at) VALUES (?, ?, ?, ?)', [tid, uid(), rc, at]);
      last = at;
    }
    await q('UPDATE forum_thread SET reply_count = ?, last_reply_at = ? WHERE id = ?', [replyN, last, tid]);
    day -= 0.8;
  }
  console.log(`论坛：已插入 ${threads.length} 帖（含回复）`);
}

// ---------- run ----------
const steps = [
  ['图书', seedBooks],
  ['失物招领', seedLostFound],
  ['社团', seedClub],
  ['论坛', seedForum],
];
for (const [name, fn] of steps) {
  try {
    await fn();
  } catch (e) {
    console.error(`[${name}] seed 失败：`, e.message);
  }
}
console.log('M3 测试数据完成');
process.exit(0);
