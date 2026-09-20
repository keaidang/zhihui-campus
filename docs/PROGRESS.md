# PROGRESS · 进度与待办

> 每次会话结束必须更新本文件。状态标记：[ ] 未开始 / [~] 进行中 / [x] 已完成 / [!] 有坑

## 当前状态

**阶段：一期（M1 教务线 + M2 学工线）全量上线 ✅ + 校园邮箱体系（注册验证码/收发件/多域名）上线 ✅**

- 线上：https://c.9o.pw/ （EdgeOne Pages，git push 后约 2.5~3 分钟自动部署；旧地址 campus.keaidang.com 仍可访问）
- 已交付：统一认证、五角色 RBAC + 组织架构、用户管理、M1 教务、M2 学工、门户 SSO、**校园邮箱（注册邮箱验证码 + 管理员开通对外收发 + /mail 收发件页 + 已发送 + 多域名后缀）**
- 质量基线：安全审计完成；M1+M2 线上 16 步全链路验证通过；邮箱收发/验证码全链路生产验证通过
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

### 阶段 3 · M3 生活服务（未开始）
- [ ] 图书借阅（schema-005）
- [ ] 二手交易 / 失物招领 / 社团活动

### 阶段 4 · 收尾（未开始）
- [ ] M4 校领导驾驶舱（只读大屏）
- [ ] uni-app 小程序端
- [ ] 种子数据完善、全流程演示彩排
- [ ] 论文初稿（选课并发控制 / 审批流引擎 / 云边协同为三章核心素材）

## 已知坑与备忘

- **TiDB Serverless 禁用 mysql2 execute()（预编译协议）**——统一走 db.js query() 文本协议；query() 已内置瞬时错误重试 + 连接池 5，别删
- **线上 500 会落库 sys_op_log(action='error.500')**，远程诊断真实错误用它
- **当前学期口径 TERM='2026-2027-1'** 硬编码在 edu 相关 API，换学期需统一修改
- 演示账号 admin/admin 为用户指定弱密码（2026-09-18），对外开放前必须改强密码
- KV 为 60 秒最终一致 → 选课名额/库存一律走数据库，KV 只放容忍延迟的计数
- TiDB Serverless 有冷启动，演示前先预热一次请求
- Supabase 免费版 7 天不活跃休眠（当前未选用，仅备忘）
- **DATETIME 一律传 Date 对象或 'YYYY-MM-DD HH:mm:ss'**：toISOString() UTC 字符串 + 连接池 timezone('+08:00') 会造成 8 小时偏移（已踩坑修复）
- **多端独立域名部署时必须配 CORS_ORIGIN 环境变量**（Node Functions 已内置 CORS 响应头与 OPTIONS 预检，未配 CORS_ORIGIN 时默认放行）
- sys_refresh_token 过期/吊销记录暂无清理任务，量大后需定期清理（低优先级）
- 登录失败锁定为实例级内存版，多实例下尽力而为，后续可迁 KV
- **db.js query() 直接返回 rows**（项目封装过），不能按 mysql2 原生 `[rows]` 解构——解构会把首行当数组用，随机 500
- **DATETIME 过期判断放 SQL 侧**（`WHERE expires_at > NOW()`）：TiDB NOW() 是服务器时区、Node 是 UTC，JS 里 new Date() 比较会误判"已过期"
- **LanQin Email POST /mailboxes 必须带 userId=主用户**（LANQIN_OWNER_USER_ID env），否则邮箱挂到自动新建的独立用户下 → /send 报 404 "mailbox not found"（实为归属校验失败）
- **LanQin GET /send 发送历史列表接口在本机常超时**——发信成功即本地写 sys_mail_sent 表，列表读库；状态用 GET /send/{id} 单封回查（60s 节流）
- EdgeOne env set 接口常超时需重试 2-3 次；env 改后必须重新部署；部署未完成时新旧函数混跑出"诡异 500"，先等满 3 分钟再测

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
  **图书借阅** `/library`：学生检索/详情/借阅（在借≤5 本、同书不可重复借、借期 30 天、条件更新扣库存防超借）/我的借阅（逾期标红）；admin 管理后台：单本/批量添加 + CSV/JSON 批量导入（ISBN 去重）、借还代管、模板下载；`lib_book.ext_source/ext_id` 预留外部图书馆系统对接。**失物招领** `/lost-found`：学工处（counselor/admin）发布（图片 blob 上传 + 描述 + 电话），全员浏览看电话，可标记已认领。**社团活动** `/club`：学生申请（位置/内容/大纲/时间/开课人）→ 教务处（teacher/admin）审批 → 发布招聘（图片+名额）→ 全员预约占名额/取消释放（唯一键+条件更新防超占）。**校园论坛** `/forum`（替代原二手集市规划）：6 板块（日常闲谈/计算机/AI 前沿/金融财经/学习资料/交易集市），仅登录用户可访问；发帖纯文本编辑+图片上传（blob 暂存，后续接图床）；交易板块发帖物品/价格/联系方式必填；admin 置顶/锁定/删帖/禁言（forum_ban）。**忘记密码**：登录页"忘记密码"→ 账号+绑定邮箱发验证码（复用 sys_email_code purpose='reset'）→ 重置并吊销全部刷新令牌；admin 用户管理新增 resetPassword 动作。测试数据（seed-m3.mjs，幂等）：420 本藏书、失物 8 条、社团 6 通过+2 待审（含预约占位）、论坛 6 板块 30+ 帖 + 回复；图片优先抓取 picsum 真实图存 sys_blob，网络不通时自动生成本地 SVG 占位图。已推送 e5911e4 并上线验证（线上 LoginView chunk 含 field-row/prefix-meta 特征）

## 下一步

- [ ] M3 图书借阅（schema-005）
- [ ] M3 二手/失物/社团
- [ ] M4 驾驶舱
- [ ] 论文正文撰写与测试数据整理（开题报告已定稿，其文献综述 / 技术路线 / 创新点章节可复用）
- [ ] 邮箱增强：附件上传发信、管理员邮箱用量统计
- [ ] 已知优化项：Element Plus 按需引入 + manualChunks 分包（主 chunk 偏大）
- [ ] 测试账号 zhreg2871（zhnewuser94@keaidang.com / RegTest@2026，已开通对外收发）确认无用后删除

