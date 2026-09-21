# PROGRESS · 进度与待办

> 每次会话结束必须更新本文件。状态标记：[ ] 未开始 / [~] 进行中 / [x] 已完成 / [!] 有坑

## 当前状态

**阶段：M1 教务线 + M2 学工线 + 校园邮箱体系 + M3 生活服务 + M4 驾驶舱/宿舍管理/站内信 全量上线 ✅**

- 线上：https://c.9o.pw/ （EdgeOne Pages，git push 后约 2.5~3 分钟自动部署；旧地址 campus.keaidang.com 仍可访问）
- 已交付：统一认证、五角色 RBAC + 组织架构、用户管理、M1 教务、M2 学工、门户 SSO、校园邮箱、M3 生活服务五模块、**M4 数据驾驶舱（schema-009 之上新增 schema-010 宿舍 / 011 站内信，宿舍报修并入宿舍管理）**
- 质量基线：安全审计完成；M1+M2 线上 16 步、M3 线上 21 步全链路验证通过；邮箱收发/验证码生产验证通过
- 新会话/新 Agent 开工：**先读 docs/HANDOVER.md**

- 2026-09-16：TiDB Cloud Starter 集群 `biyesheji`（ap-southeast-1）创建完成
- 2026-09-16：`.env`（连接配置）+ `cert/isrgrootx1.pem`（CA 证书）落盘，`.gitignore` 已排除机密
- 2026-09-16：连通性读写测试全部通过（`scripts/db-test.py`，建库 `zhihui_campus` 成功）
- 2026-09-16：项目文件夹改名"智汇校园-一站式服务平台"→"智汇校园一站式服务平台"，Git 初始化完成
- 2026-09-16：首次提交 `5be781a` 推送成功 → **GitHub 远端：github.com/keaidang/zhihui-campus**（阶段 0 完成）

## 阶段计划

### 阶段 0 · 项目基建（全部完成）
- [x] 确定项目名：智汇校园
- [x] 确定架构：EdgeOne 全栈 + TiDB Serverless（备选云 RDS）+ KV + Blob
- [x] 建立文档体系（PRD/ARCHITECTURE/DATABASE/API/CONVENTIONS/PROGRESS）
- [x] 注册 TiDB Cloud Starter + 创建 zhihui_campus 库 + 连通性测试通过
- [x] Git 仓库初始化 + 首次提交（GitHub 远端：zhihui-campus）
- [x] GitHub 推送完成（用户终端执行；凭据此前已存于 Windows 凭据管理器，无需重新授权）
- [x] EdgeOne CLI v1.6.40 安装完成（托管工作区，入口 `scripts/eo.cmd`）
- [x] EdgeOne 登录完成（国际站 Global，账号 keaitx@gmail.com）
- [x] Makers 项目关联完成：`eo.cmd makers link -n zhihui-campus`（关联配置在项目根 `.edgeone/`）
- [x] 生成控制台粘贴清单 `scripts/edgeone-env-paste.txt`（6 个环境变量 + CA 证书全文）
- [x] 控制台：开通 KV 并创建命名空间 `zhihuicampus`、绑定项目（KV 绑定变量名：`zhihuicampus`）
- [x] **阶段 1 地基代码完成（2026-09-16 晚）**：
  - 数据库：schema-001-auth.sql 已执行（sys_user / sys_role / sys_user_role / sys_refresh_token / sys_login_log）
  - 后端认证 API：register / login / refresh / logout / me + health（node-functions/），冒烟测试通过
  - Edge Functions：/api/kv-check（KV 连通性验收用）
  - Web 门户前端：Vue3 + Element Plus + Pinia，首页 + 登录/注册页
  - 安全：bcrypt + JWT 双令牌 + 刷新轮换/重放检测 + 登录锁定 + 审计日志 + 参数化查询 + 安全响应头
- [x] 控制台环境变量 JWT_SECRET 配置（生产环境）+ Git 集成自动部署（2026-09-17 验证）
- [x] 域名 https://campus.keaidang.com/ 绑定生效 + ICP 备案页脚

### 阶段 1 · 地基 + 基础部分（2026-09-17 完成）
- [x] 统一登录 + JWT 双令牌（KV session 备案，当前 Bearer 直验）
- [x] RBAC 五角色（student/teacher/counselor/leader/admin）+ guard.js 权限中间件（实时查库 + 数据范围）
- [x] 组织架构：sys_department（6 院系）+ sys_class + sys_user 扩展（user_no/dept_id/class_id）
- [x] 用户管理页（搜索/启停/角色分配/归属设置，防自锁/防越权）
- [x] 安全审计一轮（docs/AUDIT-2026-09-17.md：1 P1 + 3 P2 全修复）

### 阶段 2 · 一期双线（2026-09-17 深夜完成）
- [x] **M1 教务线**：schema-003（edu_course/edu_class/edu_elect）+ 选课 API（事务 + 条件 UPDATE 防超卖 + 唯一键防重选）+ 学生选课页 + 成绩课表页（GPA 统计）+ 教师课程/成绩录入页
- [x] **M2 学工线**：schema-004（flow_instance/flow_node 通用审批流 + af_leave/af_repair/af_notice）+ 请销假闭环（申请→审批→销假）+ 报修工单（提交/受理/完成）+ 公告（发布/置顶/撤回，院系定向）
- [x] 门户：主页 4 张服务卡 SSO 联动（未登录带 redirect 去登录→原路跳回）、工作台五角色主题色 + 账号信息卡 + 常用资源链接
- [x] 线上 16 步全链路验证（选课→审批→销假→报修→录成绩→查成绩→越权回归 40301）

### 阶段 3 · M3 生活服务（2026-09-20 深夜完成，原二手集市决策改为校园论坛）
- [x] **图书借阅** `/library`（schema-009 lib_book/lib_loan）：检索/详情/借阅（在借≤5、同书防重借、借期 30 天、条件更新防超借）/我的借阅；admin 批量添加 + CSV/JSON 导入；`ext_source/ext_id` 预留外部图书馆对接
- [x] **失物招领** `/lost-found`（lf_item）：counselor/admin 发布（blob 图 + 电话），全员浏览
- [x] **社团活动** `/club`（club_application/recruit/booking）：申请→teacher 审批→发布招聘→预约占名额/取消释放（唯一键+条件更新）
- [x] **校园论坛** `/forum`（替代二手集市，forum_board/thread/reply/ban）：6 板块仅登录可访问，交易帖物品/价格/联系方式必填，admin 置顶/锁定/删帖/禁言
- [x] **忘记密码**：管理员后台重置 + 邮箱验证码自助找回（purpose='reset'，重置吊销全部会话）
- [x] 测试数据 seed-m3.mjs：420 本书 / 失物 8 条 / 社团 6 通过+2 待审 / 论坛 30+ 帖；线上 21 步冒烟全过；预约数据已打散（fix-club-bookings.mjs）

### 阶段 4 · M4 驾驶舱 + 宿舍管理 + 站内信（2026-09-20 深夜完成）
- [x] **数据驾驶舱** `/dashboard`（admin+leader）：全校聚合只读——用户/性别/各院系分布、教务（课程/选课/平均成绩）、学工（请假/报修状态、待审批数）、宿舍入住率环形图、生活服务（图书/社团/论坛 24h 新帖）、近 7 日登录趋势、最近 10 条管理动态
- [x] **宿舍管理** `/dorm`（schema-010）：替代原独立"宿舍报修"入口（/af/repair 301 → /dorm）——学生侧我的宿舍（楼栋/床位/室友）+ 报修（复用 /api/af/repair，自动带出住宿位置）；staff 侧楼栋房间网格、入住分配（事务 FOR UPDATE：容量 + **性别楼栋约束** + 生成列唯一键"一人在住唯一"）、退宿留历史、报修处理入口
- [x] **站内信/站内通知** `/messages`（schema-011 sys_message）：消息中心（全部/未读、分页、已读/删除）+ staff 发送（指定用户/按角色/全校广播）+ 顶栏铃铛未读徽标（60s 轮询）+ 业务自动通知（请假审批结果/社团审批结果/报修受理完成，lib/notify.js 统一出口，失败不阻断主业务）
- [x] 测试数据 seed-dorm.mjs（幂等）：403 名学生性别确定性补齐（男 201/女 202）+ 384 间房（8 栋×6 层×8 间，4 人间为主含 6 人间）+ 全体学生按性别入住（403/1728 床，留空房供演示分配）

### 阶段 5 · 收尾（未开始，全部剩余项集中在此）
- [x] **移动端 H5 适配**（2026-09-20 完成）——① 门户壳汉堡 + 抽屉菜单（移动端专属，用 `v-if="isMobile"`，PC 视口下 DOM 根本不存在）② 表单与对话框窄屏全宽化 ③ 网格改 `minmax(0,1fr)` + flex 传导链阻断，五个代表页横向溢出归零 ④ 新增 `src/mobile.css` 独立适配层（只含媒体查询，PC 零回归 —— 铁律 #27/#28）
- [ ] **App 壳封装出 APK**（⚠ 本机无 Java / Android SDK / Gradle，须走云打包（PWABuilder / HBuilderX 云打包）或在有 Android Studio 的机器上做）
- [ ] 全流程演示彩排（演示前须先预热 TiDB，见"已知坑"冷启动条）
- [ ] 论文正文（开题报告 2026-09-20 已定稿约 6000 字；正文三章核心素材：选课并发控制 / 审批流引擎 / 云边协同）
- [ ] 图书封面补齐（420 本**全部** `cover_url` 为空，当前显示首字占位）
- [ ] 邮箱增强：附件上传发信、管理员邮箱用量统计
- [ ] 图片图床接入（sys_blob LONGBLOB 暂存 32 条/1.15MB → 对象存储，仅改 blob.js 与 ImgUploader）
- [ ] Element Plus 按需引入（EP 单 chunk 1.09MB 全量引入；分包已完成，非阻塞）
- [ ] 测试账号 zhreg2871（id 12209012）确认无用后删除

## 已知坑与备忘

- **TiDB Serverless 禁用 mysql2 execute()（预编译协议）**——统一走 db.js query() 文本协议；query() 已内置瞬时错误重试 + 连接池 5，别删
- **线上 500 会落库 sys_op_log(action='error.500')**，远程诊断真实错误用它
- **当前学期口径 TERM='2026-2027-1'** 硬编码在 edu 相关 API，换学期需统一修改
- 演示账号 admin/admin 为用户指定弱密码（2026-09-18），对外开放前必须改强密码
- KV 为 60 秒最终一致 → 选课名额/库存一律走数据库，KV 只放容忍延迟的计数
- TiDB Serverless 有冷启动，演示前先预热一次请求
- Supabase 免费版 7 天不活跃休眠（当前未选用，仅备忘）
- **DATETIME 传参写 'YYYY-MM-DD HH:mm:ss' 字符串最稳**（连接池 timezone='Z'，即 UTC 墙钟口径；见下方"时间口径"备忘）
- **多端独立域名部署时必须配 CORS_ORIGIN 环境变量**（Node Functions 已内置 CORS 响应头与 OPTIONS 预检，未配 CORS_ORIGIN 时默认放行）
- **★ 移动端表格（2026-09-21 修正）**：**不要给 `.el-table` 加 `max-width`** —— EP 会把所有列按比例压缩到容器宽度内，多列表格（如账号管理 11 列）会被压成一条条按钮堆叠、完全不可读。正解是 `table.el-table__header/__body { width: max-content; min-width: 100% }`，容器不足时由 EP 自带 `.el-scrollbar__wrap` 横向滚动。**移动端表格验收必须同时满足**：① 页面无横向溢出 ② 有数据行时最宽列 > 80px（`node .shots/audit-tables.mjs`）
- **★ 移动端适配（2026-09-20 深夜）**：`src/mobile.css` 只允许 `@media (max-width: 820px)` 块（PC 零回归保证）；断点须与 `utils/device.js` 的 `MOBILE_MAX_WIDTH` 同值；**覆盖组件 scoped 样式必须三倍类名**（组件 CSS 路由懒加载，`<link>` 运行时插入在本文件之后，双类名同权重会被反超）；窄屏横向溢出两大根因 = grid 的 `1fr`（实为 `minmax(auto,1fr)`，改 `minmax(0,1fr)`）+ flex column 交叉轴被内容 min-content 撑开（须在 `.shell-body` 层就 `overflow-x:hidden`，只在 `.shell-main` 写无效）；内联固定宽度需 `!important`。详见 HANDOVER 铁律 #27/#28
- sys_refresh_token 过期/吊销记录清理：**已有 `scripts/cleanup.mjs`**（dry-run 默认，`--yes` 执行，覆盖 refresh_token / blob / login_log）；另 login.js 登录成功时 5% 概率顺带清理
- 登录失败限流：**已由内存版改为 DB 流水计数**（sys_login_log 失败流水 + sys_email_code），多实例安全；细节见变更记录"边缘网关试错与回滚"条
- **db.js query() 直接返回 rows**（项目封装过），不能按 mysql2 原生 `[rows]` 解构——解构会把首行当数组用，随机 500
- **DATETIME 过期判断放 SQL 侧**（`WHERE expires_at > NOW()`）：TiDB NOW() 是服务器时区、Node 是 UTC，JS 里 new Date() 比较会误判"已过期"
- **LanQin Email POST /mailboxes 必须带 userId=主用户**（LANQIN_OWNER_USER_ID env），否则邮箱挂到自动新建的独立用户下 → /send 报 404 "mailbox not found"（实为归属校验失败）
- **LanQin GET /send 发送历史列表接口在本机常超时**——发信成功即本地写 sys_mail_sent 表，列表读库；状态用 GET /send/{id} 单封回查（60s 节流）
- EdgeOne env set 接口常超时需重试 2-3 次；env 改后必须重新部署；部署未完成时新旧函数混跑出"诡异 500"，先等满 3 分钟再测
- **EdgeOne node functions 不支持路径参数**：`/api/xx/<id>` 会落到 SPA 返回 index.html——动态参数一律用查询串（如 `/api/blob?token=xxx`）
- **EdgeOne POST body 缺键偶发 "Body has already been read" 500**：服务端先把缺失键归一化（`?? '' / null`）再校验；前端表单始终发全量字段
- **写 SQL 引用字段前对照真实 DDL**：club_recruit 没有 location/activity_time（在 club_application），曾致 scope=mine 恒 500（c8341f8 已修）
- **★ 时间口径（2026-09-20 深夜重定义）**：TiDB 会话时区 = UTC，**库内一切时间都是 UTC 墙钟**（业务全用 NOW()）；`lib/db.js` 的 mysql2 `timezone` 必须为 `'Z'`（曾误配 `'+08:00'` → Date 偏 8h，连带刷新令牌多活 8h、60s 频控失效、登录趋势早一天）；**前端展示唯一入口 `src/utils/time.js` 的 `fmtTime()/fmtAgo()`**，禁止手写 `String(x).replace('T',' ').slice(0,16)`；Node 侧导出格式化须带 `{ timeZone:'Asia/Shanghai' }`；用户日期选择器的墙钟落库前 -8h 转 UTC（af/leave.js）

## 变更记录

- 2026-09-16：项目初始化、TiDB 就绪、阶段 1 地基上线（认证 + 门户）
- 2026-09-16（深夜）：地基代码审计后修复（时区偏移/丢登录态/频控/事务化/CORS）；UI 改版庄重学术蓝
- 2026-09-17：品牌与合规上线（域名/校徽/书法校名/ICP 备案）；登录 500 破案（JWT_SECRET 注入 + TiDB 文本协议）；功能架构定稿（五角色 + 一期双线 + 砍点餐）
- 2026-09-17（晚）：基础部分落地（schema-002 五角色/院系/班级、guard.js、管理端 API、PortalShell/工作台/用户管理）；安全审计修复（P1 归属越权 + sys_op_log 审计 + 保留用户名 + 仓库卫生）；db.js 瞬时错误重试根治随机 500（15/15 压测零 500）
- 2026-09-17（深夜）：**M1 教务线 + M2 学工线全量上线**（schema-003/004、7 个业务 API、9 个业务页面）；主页 SSO 联动；工作台五角色主题改版（--role-accent）+ 校园实景背景 + 资源链接；16 步线上验证全过；修复公告 LEFT JOIN/出分课程课表消失/选课返回体三个 bug
- 2026-09-18：admin 密码按用户要求重置为 `admin`（弱密码，演示专用）；**文档全面更新 + 新增 HANDOVER.md 交接文档**
- 2026-09-19：**演示数据批量生成**（402 学生/40 教师/8 辅导员/10 校领导/14 班/27 课程/59 教学班/约 2006 选课，scripts/seed-demo.mjs 幂等）；系部与班级管理补全（/admin/org 双 Tab，删除保护、辅导员越权 403）；选课超员修复（seed 数据绕过 API 所致，跨班共享容量重灌，核实超员 0）；课表导出根治（固定网格 周一~周日 × 6 大节次）+ 选课时段冲突校验（42007）+ 行政部门 10 个/29 名行政人员（schema-006 dept_type，seed-admin-staff.mjs）
- 2026-09-20（上午）：备案号新增鲁ICP备2025186072号（三处页脚与苏ICP并列）；**校园邮箱体系上线**：注册邮箱验证码（6 位/10 分钟/频控）、校园邮箱前缀分配（学号/工号）、管理员开通对外收发（LanQin 真实邮箱，密码可见可导出）、工作台邮箱卡；发件归属 404 根治（POST /mailboxes 带 userId）；7 项体验优化（僵尸用户筛选/管理员邮箱管理/域名后缀等）
- 2026-09-20（午后）：**/mail 收发件页面**（收件箱/已发送/详情/写邮件，未开通显示引导）；sys_mail_sent 本地发件表（GET /send 列表接口超时弃用）；多域名后缀（LanQin 实时 6 域名，注册/管理员可选，后端白名单校验）；邮件页去彩色 emoji 改色点；已发送状态实时回查（60s 节流）；**登录态 F5 丢失修复**（auth store 单飞 Promise 治并发恢复/刷新竞态）；首屏提速（4 张 PNG→WebP，7MB→476KB + preload）；邮箱页换 lucide 图标
- 2026-09-20（晚）：**修复注册页邮箱后缀下拉"无数据"**——LoginView.vue 模板引用了 domains/regForm.domain 但脚本从未定义/加载；补上 domains ref + 页面加载时拉 /api/auth/register/domains + 注册提交携带 domain（后端本就支持，纯前端缺陷）
- 2026-09-20（晚·论文）：**本科毕业设计开题报告成稿**《基于云边协同与 Serverless 架构的"智汇校园"一站式服务平台设计与实现》（约 6000 字正文 / 16 条可查证参考文献，含 GB/T 36342—2018 国标）。素材全部取自本仓库 docs/（PRD / ARCHITECTURE / DATABASE / 商用架构调研），产出 DOCX 交付物：封面信息栏(占位符) + 18 条可点击两级目录 + 摘要 + 五章正文 + 三线表 + 参考文献，页脚页码、封面无页码。产物路径见 `.workbuddy` 会话流水线 output/&lt;request_id&gt;/stage3/
- 2026-09-20（深夜）：**修复注册页输入框被挤没**——`el-input` 用 `#append` 时 Element Plus 渲染为 `display:table` 的 `.el-input-group`，430px 卡片（内容区 340px）里追加按钮把真正的输入区压到只剩几十像素（邮箱占位符被截断、前缀框只剩一个图标）。改为「输入框 + 按钮/下拉做成兄弟节点」的 `.field-row` flex 布局，并覆盖 `.gate-card .el-button` 的 6px 字距；"检查可用"从输入框内挪到提示行右侧文字链（前缀校验后端需查邮件服务器约 4~10s，故不逐字自动校验，仅显式触发 + 14s 前端超时兜底）。管理员"设置校园邮箱"对话框同步修复：原先硬编码 `@keaidang.com`（`addrDomain` 有状态却没用、接口也没传 domain），改为可选后缀下拉并传 domain（后端 updateAddress 本就支持）
- 2026-09-20（深夜·M3）：**M3 生活服务五模块全量上线**（schema-009 + 12 个 API + 5 个前端视图 + seed-m3 测试数据）——
  **图书借阅** `/library`：学生检索/详情/借阅（在借≤5 本、同书不可重复借、借期 30 天、条件更新扣库存防超借）/我的借阅（逾期标红）；admin 管理后台：单本/批量添加 + CSV/JSON 批量导入（ISBN 去重）、借还代管、模板下载；`lib_book.ext_source/ext_id` 预留外部图书馆系统对接。**失物招领** `/lost-found`：学工处（counselor/admin）发布（图片 blob 上传 + 描述 + 电话），全员浏览看电话，可标记已认领。**社团活动** `/club`：学生申请（位置/内容/大纲/时间/开课人）→ 教务处（teacher/admin）审批 → 发布招聘（图片+名额）→ 全员预约占名额/取消释放（唯一键+条件更新防超占）。**校园论坛** `/forum`（替代原二手集市规划）：6 板块（日常闲谈/计算机/AI 前沿/金融财经/学习资料/交易集市），仅登录用户可访问；发帖纯文本编辑+图片上传（blob 暂存，后续接图床）；交易板块发帖物品/价格/联系方式必填；admin 置顶/锁定/删帖/禁言（forum_ban）。**忘记密码**：登录页"忘记密码"→ 账号+绑定邮箱发验证码（复用 sys_email_code purpose='reset'）→ 重置并吊销全部刷新令牌；admin 用户管理新增 resetPassword 动作。测试数据（seed-m3.mjs，幂等）：420 本藏书、失物 8 条、社团 6 通过+2 待审（含预约占位）、论坛 6 板块 30+ 帖 + 回复；图片优先抓取 picsum 真实图存 sys_blob，网络不通时自动生成本地 SVG 占位图
- 2026-09-20（深夜·M3 验证）：**线上 21 步冒烟全过**（student004 全链路：检索→借书→防重借→归还；失物权限 403/发布/下架；社团预约占名额→取消释放；论坛 401 拦截/交易必填/发帖回帖；blob 公共读 image/jpeg；忘记密码负路径）。期间修了两个 EdgeOne 平台坑：①node functions 不支持路径参数，/api/blob/&lt;token&gt; 会落到 SPA——改查询串 /api/blob?token= 并迁移存量 URL；②POST body 缺键时偶发"Body has already been read" 500——服务端把缺失键归一化后再校验绕开（前端表单本就发全量字段，真实用户不受影响）。已推送 e5911e4 并上线验证（线上 LoginView chunk 含 field-row/prefix-meta 特征）
- 2026-09-20（M3 修复）：**社团"我的预约"500 + 预约数据分布修复**（c8341f8）——①`/api/club/recruit?scope=mine` 的 SQL 误引用 `r.activity_time`/`r.location`（这两字段在 `club_application` 表，`club_recruit` 没有），ER_BAD_FIELD_ERROR 1054 导致所有用户"我的预约"恒 500（取消后重约成功也看不到，表象即"我的预约里没有"）；改为 join club_application 取地点/时间。②seed-m3 把每个招聘的预约都塞给 `students.slice(0, taken0)` 同一批前排学生，导致 student001~004 等测试号在几乎全部社团显示"已预约"（数据合法但演示观感差）；用 scripts/fix-club-bookings.mjs 把存量 34 条预约随机打散到 400 名学生（各招聘 taken 数不变），student004 仅保留 AI 兴趣社 1 条。线上复测：我的预约 code=0、预约→取消→再预约→再取消闭环全过
- 2026-09-20（体检修复）：**体检 P1/P2 全清**（219159f）——①邮件正文 XSS：MailView.vue v-html 直渲染外部来信 HTML 未消毒，引入 DOMPurify（FORBID style 标签，默认去 script/事件属性/javascript: 协议）；②分包：vite manualChunks 把 element-plus/vendor-vue/lucide/dompurify 拆独立 chunk，**index 主包 1219KB→18.7KB**（EP 1.09MB 长缓存，仅构建提示仍>500KB，属 EP 全量引入固有，按需引入为后续项）；③清理任务：login.js 登录成功 5% 概率顺带清过期/吊销刷新令牌 + 新增 scripts/cleanup.mjs（dry-run 默认，--yes 执行；refresh_token/blob/login_log 三表）；④文档口径：PRD 二期勾选完成、验收标准更新，ARCHITECTURE ADR-4 blob 目录旧口径改为 sys_blob 表暂存，blob.js 注释同步查询串口径
- 2026-09-20（边缘网关试错与回滚）：**边缘限流网关实测不可行，方案 B 落地**（20b11ac/8026bd2/6b8472b 回滚 + d00a57f/897acb4/b0b5ce8）——曾实现 /api/gw 边缘网关（KV 限流 + 令牌黑名单 + 跨域回源代理），实测发现 **EdgeOne 边缘函数 fetch 子请求不进函数路由**（同域落静态层返回 SPA；blacklist 固定路径端点正常、catch-all 代理始终返回 SPA），代理架构不可行，回滚。限流改 Node 侧后又踩两个平台坑：①**Node 多实例内存不共享**（内存 rateLimit 30 连发零触发）；②**x-forwarded-for 是 EdgeOne 出口代理池 IP**（非真实客户端 IP，按 IP 计数被稀释）。最终口径：**限流走 DB 流水计数**——登录=sys_login_log 失败流水（账号 5 失败/min 防撞库 + 出口 IP 60 失败/min 辅助，实测 8 连发第 6 次起 429）、忘记密码发码=sys_email_code 3 次/hour/IP、注册沿用既有 DB 频控；刷新端点不做频控（轮换+重放检测已足够）。边缘价值改用原生轻端点体现：新增 /api/edge/stats（KV 访问统计，无 DB、边缘毫秒级），HomeView 挂 fire-and-forget 埋点；HomeView 模块卡更新至 M3 现状；架构文档同步（铁律 #23/#24、ARCHITECTURE 2.5 平台行为结论）
- 2026-09-20（时间口径归一·深夜）：**全站时间显示错乱修复**（a04f4a6/b4dc948）——用户报"驾驶舱数据有问题、时间是乱的、undefined"。首因是字段名不一致（后端 `o.created_at` vs 前端 `row.createdAt`），深挖出**系统性时区 bug**：TiDB 会话时区即 UTC（`@@system_time_zone='UTC'`，`NOW()` 比北京早 8h 即正常），库内全存 UTC 墙钟，而 mysql2 连接误配 `timezone:'+08:00'` 把 UTC 墙钟当北京墙钟解读 → **所有 Date 对象整体早 8 小时**（判定锚点：sys_login_log 记 admin 登录 `14:37:41`，而用户正是北京 22:37 登录查看日志的）。连带真 bug：JSON 输出偏 8h、刷新令牌多活 8h、**60s 重发频控实际失效**、登录趋势日期整体早一天、CSV 导出显示 UTC。修复：①db.js `timezone:'Z'`；②新增 `src/utils/time.js`（fmtTime/fmtAgo）作为展示唯一入口，16 处前端手写字符串截断全部替换（af×5 / dorm / m3×4 / admin×3 / Message / Workbench）；③CSV 格式化加 `Asia/Shanghai`；④驾驶舱 recentOps 返回真实瞬时 + 过滤 error.500 历史噪音、登录趋势按北京日期分桶；⑤请假起止（日期选择器墙钟）落库前转 UTC + 存量 3 行迁移；⑥admin 有效期入参（北京日历日）改字符串 `15:59:59`。线上 11 项验收全过，前端 chunk 确认换新（padStart 特征在、旧截断写法消失）

- 2026-09-20（移动端适配·深夜）：**「不做小程序」决策落地 + 移动端 H5 适配上线**——① **决策**：微信小程序砍掉（个人主体无 web-view 权限、纯套壳易被拒审、小程序自身亦须 ICP 备案），替代为「响应式 H5 + App 壳封装」，PRD §4 不做清单与 ARCHITECTURE **ADR-8** 记录依据；② **实现**：新增 `src/mobile.css`（媒体查询适配层，文件内禁止全局裸规则 → PC 零回归）+ `src/utils/device.js`（`useIsMobile`），PortalShell 加汉堡按钮与抽屉菜单（`v-if="isMobile"`，PC 下 DOM 不渲染），全局表单/对话框/表格/分页窄屏适配，网格单列化与溢出修复；③ **踩坑**：组件 scoped 样式因路由懒加载的 `<link>` 晚于全局样式插入而反超，双类名不够、**须三倍类名**；窄屏溢出根因是 grid `1fr`（=`minmax(auto,1fr)`）与 flex column 交叉轴被内容撑开（须在 `.shell-body` 层阻断传导链）；④ **附带修复**：驾驶舱"在校学生"卡显示 `[object Object]`（`genderText` 是 computed ref，在 JS 模板字符串里漏 `.value`，PC 端同样错）；⑤ **验收**（Playwright + 系统 Edge，`/api/*` 转发至线上）：PC 视口下 `.shell-burger`/`.shell-drawer` 数量 **0**、侧栏仍 196px、无溢出；手机视口（390×844）汉堡存在、侧栏隐藏、抽屉 19 项、workbench/dorm/library/forum/dashboard **五页 `scrollWidth === innerWidth` 全等（零横向溢出）**；⑥ 提交范围可证：`src/styles.css` **零改动**，PortalShell 仅删 4 行（全在原 820px 移动端断点内）

- 2026-09-21（项目体检）：**全面体检 + 修复 3 项机制缺陷**（11972a9），报告见 **docs/AUDIT-2026-09-21.md**——体检范围：线上环境 + 全量源码（数据一致性 18 类 SQL 核对 / 22 路由自动化遍历 / 依赖审计 / 静态扫描）。① **修复静态层零安全头**：API 头在 `http.js` 早已加齐，但 `edgeone.json` 无 `headers` 配置 → 用户实际访问的 HTML/JS/CSS **一个安全头都没有**（防护全加在看不见的 API、真正暴露的页面层裸奔）；补 CSP/HSTS/X-Frame-Options/nosniff/Referrer-Policy/Permissions-Policy，并补 assets 长缓存 + index.html no-cache；线上 11 项验证通过，且 **CSP 未打断任何功能**（21 路由零违规、零 JS 错误）。② **修前端无全局错误处理**：未捕获组件异常会中断渲染（此前"页面空白"现象即源于此），补 `app.config.errorHandler` + `unhandledrejection`（只记录不弹窗，避免与 request.js 的提示重复）。③ **修懒加载 chunk 失效白屏**：22/26 路由懒加载 + 部署频繁，用户停在旧页面再点新路由会请求**已被替换的旧 chunk** → 404 白屏，补 `router.onError` 自动硬刷新一次（标志位防刷新循环）。④ **确认健康**：数据一致性 18 类全 0 不一致、SQL 全参数化且动态 SET 为字段白名单、写端点 100% 鉴权、`npm audit` 0 漏洞、移动端 22 路由零横向溢出、线上零新增错误、无 TODO/遗留 log/`<script setup>` 漏 `.value`。⑤ **新增 `scripts/integrity-check.mjs`**（只读数据体检，已入白名单）。⑥ 遗留 14 项技术债已按 P0~P2 分级（P0=演示弱密码对外前必改；P1=无测试无 lint / 报修双路径口径 / EP 全量引入 / 图床；P2=封面、学期硬编码、监控告警等）

- 2026-09-21（移动端表格修复）：**修复移动端表格被压扁的回归**——用户反馈"账号管理页在手机上完全不可读"。根因：2026-09-20 那版为消除"页面横向溢出"，给 `.el-table` 加了 `max-width: 100%`，而 **Element Plus 会把所有列按比例压缩**到容器宽度内：11 列的账号管理页列宽只剩 42~60px，行内容退化成一列列按钮堆叠。**本质是"测试口径不完整"导致的回归**——当时只断言了 `documentElement.scrollWidth === innerWidth`（无溢出→通过），**没断言"列是否还可读"**。修正：`table.el-table__header/__body { width: max-content; min-width: 100% }`，容器不足时改由 EP 自带的 `.el-scrollbar__wrap` 横向滚动（少列表格不被拉宽、多列表格可左右滑）。实测 13 个含表格页面：7 个有数据行的页面列宽全部恢复（70~390px）+ 零溢出 + 可滚动；4 个无数据行/隐藏 tab 的页面自动降级为只校验溢出。PC 端零影响（规则在媒体查询内，PC 表格仍为 1000px 容器 + 内部滚动）。同时新增 `node .shots/audit-tables.mjs` 表格专项体检（新口径：溢出 + 列宽双断言）

## 下一步

> 详细剩余项与整改建议已收敛到 **docs/AUDIT-2026-09-21.md**（2026-09-21 全面体检报告，含 P0~P2 分级与工作量估计），此处不再重复维护（避免漂移）。

- **[x] 移动端 H5 适配**（2026-09-20 完成）；小程序已决策不做（PRD §4 + ARCHITECTURE ADR-8）
- **[ ] P0（对外前必做）**：演示账号 `admin/admin` 改强密码，并从文档移除明文（见 AUDIT P0-1）
- **[ ] P1（工程护栏，最值得先做）**：把已有冒烟脚本固化成一条 `npm run check`；再逐步补 ESLint 与关键路径单测（见 AUDIT P1-1）
- **[ ] P1**：统一报修口径（纯文档，20 分钟，见 AUDIT P1-2）/ EP 按需引入 / 图片图床
- **[ ] P2**：图书封面、邮箱附件、学期口径、监控告警、备份演练、删测试账号 zhreg2871、App 壳打包

