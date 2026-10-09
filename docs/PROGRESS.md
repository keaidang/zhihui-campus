# PROGRESS · 进度与待办

> 每次会话结束必须更新本文件。状态标记：[ ] 未开始 / [~] 进行中 / [x] 已完成 / [!] 有坑

## 当前状态

**阶段：M1 教务线 + M2 学工线 + 校园邮箱体系 + M3 生活服务 + M4 驾驶舱/宿舍管理/站内信 全量上线 ✅**

- 线上：https://c.9o.pw/ （EdgeOne Pages，git push 后约 2.5~3 分钟自动部署；旧地址 campus.keaidang.com 仍可访问）
- 已交付：统一认证、五角色 RBAC + 组织架构、用户管理、M1 教务、M2 学工、门户 SSO、校园邮箱、M3 生活服务五模块、**M4 数据驾驶舱（schema-009 之上新增 schema-010 宿舍 / 011 站内信，宿舍报修并入宿舍管理）**
- 质量基线：安全审计完成；M1+M2 线上 16 步、M3 线上 21 步全链路验证通过；邮箱收发/验证码生产验证通过
- **AI 融合方向已定版（2026-10-09 同日修订，待实施）**：模型 **qwen3.8-omni-flash**（阿里云 DashScope 兼容网关，实测上下文 40 万字、`reasoning_content` 独立字段），实施顺序 lib/ai.js 统一出口 → 驾驶舱意图问数+管理员辅助 → 论坛 AI 审核 → RAG，唯一口径见 **ARCHITECTURE ADR-9**。**⚠ 开发测试期只用文本输入输出、禁碰多模态（计费高）；思考模式默认关**
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
- [x] 测试账号 zhreg2871（id 12209012）已处理（2026-10-07）：**停用 + 注销对外邮箱 + 吊销全部刷新令牌 + 退宿**（有住宿/邮件引用，硬删会破坏关联，采用可逆的软停用）

### 阶段 6 · AI 融合（2026-10-09 开工；**P0~P3 已完成**，P4~P9 进行中）

**⚠ 实施进度以 [docs/AI-FEATURES.md](AI-FEATURES.md) §9 的 P0~P9 为准**（步骤级计划 + 每阶段验收）。当前：

| 阶段 | 状态 | 产出 |
|---|---|---|
| P0 准备 | ✅ 2026-10-09 | `docs/AI-KB-SOURCES.md`（知识库核对清单）、`lib/sse.js`、`api/ai/stream-probe.js` |
| P1 底座 | ✅ 2026-10-09（commit `68fe735`） | `database/schema-012-ai.sql`（已执行到生产库）+ 6 个 lib（`ai/ai-config/ai-guard/ai-kb/alert` + `lanqin.sendMail`）+ 39 项单测 |
| P2 知识库 | ✅ 2026-10-09（commit `ea42b90`） | `scripts/seed-ai-kb.mjs`（唯一数据源，幂等）、`docs/AI-KB-CONTENT.md`（67 条 / 7962 字） |
| P3 C1 问答 | ✅ 2026-10-09 | `api/ai/status.js`、`api/ai/chat.js`、`lib/ai-variant.js`、`views/AIView.vue`、`components/AiOrb.vue`、`stores/ai.js`、`api/ai.js` + 路由/菜单/工作台卡片 |
| P4 服务层 / P5 C2+C3 / P6 C5 / P7 C4+C6 / P8 C7~C12 / P9 控制台 | ⏳ 待做 | 见 AI-FEATURES §9 |

> **★ P3 期间实测的新结论（两条，已生效）**
> 1. **EdgeOne Node Functions 支持真流式 SSE**——用 `api/ai/stream-probe.js` 线上实测：4 个约定间隔 400ms 的分片在客户端**逐个到达**（间隔 392/401/403ms）。因此 C1 走**真流式打字机**，AI-FEATURES §8-5 标注的"平台缓冲风险"已排除（降级路径保留但不再触发）。验证脚本 `working/stream-probe-live.mjs`。
> 2. **兼容网关的流式响应自带 `usage`**（无需 `stream_options.include_usage`），且含 `prompt_tokens_details.cached_tokens`——上游上下文缓存生效，token 统计是**真值**不是估算。验证脚本 `working/stream-usage-probe.mjs`。

---

> 唯一口径 = ARCHITECTURE **ADR-9**（选型依据 / 四路径 / 硬约束）。模型已实测连通：**qwen3.8-omni-flash**（阿里云 DashScope 兼容网关 `https://dashscope.aliyuncs.com/compatible-mode/v1`，仅国内站可用），HTTP 200 / JSON 正常 / 上下文 40 万字通过。
> **★ 详细设计方案（v1，2026-10-09 用户已确认，范围 C1~C12 全量一次做完）= [docs/AI-FEATURES.md](AI-FEATURES.md)**：C1 校园问答 / C2 论坛 AI 审核员 / C3 异常告警邮件 / C4 审批助手 / C5 管理员智能管理 / C6 校领导问数 + C7~C12 全部建议项；**累加式能力分级（标准/审批/校领导/管理员四版）+ 浅色调按角色变主标识色**；技术底座 + schema-012 + 接口清单。决定项见其第 8 节（已全部确认）。
> **★★ 两条硬约束：① 开发测试期只用「文本输入 → 文本输出」，禁止任何多模态调用（图片/音频/视频计费高）；② 思考模式默认关闭（`enable_thinking: false`）。**

- [ ] **lib/ai.js 统一出口**：qwen3.8-omni-flash 唯一调用点（OpenAI 兼容），密钥仅 `.env`/EdgeOne env（`AI_QWEN_API_KEY / AI_QWEN_BASE_URL / AI_QWEN_MODEL / AI_PROVIDER`）；`enable_thinking` 作显式参数（默认 false）；try/catch + 超时降级，AI 故障不阻断业务（照 lib/notify.js 模式）
- [ ] **驾驶舱意图问数 + 管理员辅助**（优先，答辩演示项）：自然语言 → 意图分类+参数抽取（强制 JSON + few-shot）→ **白名单操作/参数化 SQL 模板**（模型永不拼 SQL、永不直接执行）→ 结果表格 + 模型摘要；**破坏性操作（如"禁用全部账号"）先列影响清单再二次确认**，action 必须再过 guard.js 实时鉴权，写操作进 sys_op_log（标 `via: ai`）；接口加 DB 流水频控
- [ ] **论坛 AI 审核（纯文本）**：发帖/回复**文本**违规判定（分类+置信度），高风险转人工队列、低风险放行、判定留痕 sys_op_log。⚠ 图片视觉审核**暂缓**（多模态计费高）
- [ ] **RAG 校园问答**（可选，时间富余再做）：制度/FAQ 文档切片向量化入 TiDB 向量列 → **TopK 检索** → 带引用生成回答（禁整篇长文档塞上下文）
- [ ] **论文同步**：补 AI 融合章节（设计 + 实测数据：延迟 / token / 准确率）；实施后回填 ADR-9 与本文件
- [ ] **上线前置**：EdgeOne 控制台补配 `AI_QWEN_*` 环境变量并重新部署（铁律 #5：env 改了不重新部署不生效）

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
- **★ AI 融合约束（2026-10-09 定版 + 同日修订，写 AI 代码前必读）**：模型 **qwen3.8-omni-flash**（阿里云 DashScope 兼容网关 `https://dashscope.aliyuncs.com/compatible-mode/v1`，**仅国内站可用**；配置键 `AI_QWEN_*` + `AI_PROVIDER` 在 `.env`，密钥不入库不入文档；GLM 三键保留备用）。**★★ ① 开发测试期只用文本输入输出，禁止任何多模态调用（图片/音频/视频计费远高于文本）；② 思考模式默认关闭 `enable_thinking:false`（意图 JSON 快 6.2 倍、输出 token 降 94%，且只有关思考时 `tool_choice: required` 才可用）**。上下文很大（实测 40 万字通过）但 **RAG 仍走检索 TopK，禁整篇塞上下文**；所有 AI 调用必须 try/catch + 超时降级（**AI 挂了业务照常**）；模型输出只做意图/参数/判定，**操作与 SQL 一律白名单预写、模型永不直接执行**；破坏性操作先列清单再二次确认 + guard.js 鉴权 + sys_op_log 审计；AI 接口加 DB 流水频控（禁内存计数）。完整口径见 ARCHITECTURE ADR-9 与 HANDOVER 铁律 #36
- sys_refresh_token 过期/吊销记录清理：**已有 `scripts/cleanup.mjs`**（dry-run 默认，`--yes` 执行，覆盖 refresh_token / blob / login_log）；另 login.js 登录成功时 5% 概率顺带清理
- 登录失败限流：**已由内存版改为 DB 流水计数**（sys_login_log 失败流水 + sys_email_code），多实例安全；细节见变更记录"边缘网关试错与回滚"条
- **db.js query() 直接返回 rows**（项目封装过），不能按 mysql2 原生 `[rows]` 解构——解构会把首行当数组用，随机 500
- **DATETIME 过期判断放 SQL 侧**（`WHERE expires_at > NOW()`）：TiDB NOW() 是服务器时区、Node 是 UTC，JS 里 new Date() 比较会误判"已过期"
- **keaidang mail POST /mailboxes 必须带 userId=主用户**（LANQIN_OWNER_USER_ID env），否则邮箱挂到自动新建的独立用户下 → /send 报 404 "mailbox not found"（实为归属校验失败）
- **keaidang mail GET /send 发送历史列表接口在本机常超时**——发信成功即本地写 sys_mail_sent 表，列表读库；状态用 GET /send/{id} 单封回查（60s 节流）
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
- 2026-09-20（上午）：备案号新增鲁ICP备2025186072号（三处页脚与苏ICP并列）；**校园邮箱体系上线**：注册邮箱验证码（6 位/10 分钟/频控）、校园邮箱前缀分配（学号/工号）、管理员开通对外收发（keaidang mail 真实邮箱，密码可见可导出）、工作台邮箱卡；发件归属 404 根治（POST /mailboxes 带 userId）；7 项体验优化（僵尸用户筛选/管理员邮箱管理/域名后缀等）
- 2026-09-20（午后）：**/mail 收发件页面**（收件箱/已发送/详情/写邮件，未开通显示引导）；sys_mail_sent 本地发件表（GET /send 列表接口超时弃用）；多域名后缀（keaidang mail 实时 6 域名，注册/管理员可选，后端白名单校验）；邮件页去彩色 emoji 改色点；已发送状态实时回查（60s 节流）；**登录态 F5 丢失修复**（auth store 单飞 Promise 治并发恢复/刷新竞态）；首屏提速（4 张 PNG→WebP，7MB→476KB + preload）；邮箱页换 lucide 图标
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

- 2026-09-21（移动端操作列）：**账号管理页操作列收进「更多」下拉**（方案 B）——该页操作列有 8 个按钮、PC 列宽 390px，窄屏平铺既占满屏宽又要长距离横滑才能点到最后的"删除"。做法：模板用 `.op-full` 包住原平铺按钮（PC 用），新增 `.op-more`（`el-dropdown` + `onRowMore` 命令分发，窄屏用）；`.op-more` 在 scoped 样式里默认隐藏，`mobile.css` 窄屏翻转并用 `:has(.op-more)` 把操作列收窄到 92px。实测 10 项断言全过：手机端平铺按钮隐藏、下拉 8 项可展开且能触发原操作（归属对话框正常打开）、操作列 92px、页面零溢出；**PC 端零变化**（8 个按钮仍平铺、列宽仍 390px）。经全量扫描（15 个操作列）确认只有此页需要改造 —— 其余操作列仅 1~2 个按钮（列宽 90~190px），平铺点击更少、无横滑压力，**刻意不改造**

- 2026-09-21（工作台铺满）：**修复"卡片左右铺不满"**——用户反馈工作台卡片左右留白过大。排查发现**不是 padding 问题**（padding 只会造成左右对称的留白，而实测左 12px / 右 26px **不对称**），真因两个：① `.shell-body` 在 PC 是 row + **`align-items: flex-start`**（刻意为之，让侧栏与内容顶部对齐），窄屏改 column 时漏把 align-items 改回 `stretch` → 子项按内容自然宽度收缩，`.shell-main` 只有 320px 而容器内容区 366px；② WorkbenchView 的 **`.wb-zoom { zoom: 1.1 }`**（PC 刻意放大）在窄屏导致左右不对称。修复：窄屏 `align-items: stretch` + 取消 `.wb-zoom` 缩放。实测手机卡片 366px、左右各 12px 对称、全站 22 路由零溢出；PC 端零影响（zoom 仍 1.1、卡片仍 1014px）。已写进 HANDOVER 铁律 #32

- 2026-09-21（EP 按需引入）：**Element Plus 由全量注册改为按需引入**（c3e9bee）——原先 `app.use(ElementPlus)` 全量注册，产物里 EP 单包 **1088KB（gzip 341KB）**，而项目实际只用到 **36 个** `el-*` 组件。改用 `unplugin-vue-components` + `ElementPlusResolver` 按需打包（含各自样式）后：**最大 chunk 1088KB→172KB（-84%）**、EP 部分 1088KB→516KB（-53%）、**gzip 341KB→~145KB（-58%）**、**首页首屏引用的 JS 最大仅 62KB**。三类模板插件捕获不到的必须手动处理（漏一个就是线上故障）：① **`ElMessage`(245处)/`ElMessageBox`(33处) 的样式**（JS 里调用，模板插件看不见）② **`v-loading` 指令**(25处) 的注册与样式 ③ **中文 locale**（改由 `App.vue` 的 `el-config-provider` 提供）。图标因 `:is="m.icon"` 是**字符串**组件名无法按需解析，保持全量并单独分包 `ep-icons`；`manualChunks` 里原来的 `'element-plus': ['element-plus']` 必须删除，否则会把整包塞进一个 chunk、**直接废掉按需**。验证：36 个组件样式在产物 CSS 中**逐一确认无遗漏**（`el-option` 无独立类名属正常，样式挂在 `.el-select-dropdown__item`）、关键组件 computed style 未退化、全站 21 路由渲染正常零 console 错误。详见 HANDOVER 铁律 #33

- 2026-09-21（报修模型口径统一）：**核实「报修两条写入路径模型不一致」为失实判断，并连带修复两个真实缺陷**——① **事实核查**：审计报告 P1-2 原称"`/api/af/repair` 建流程实例、`/api/dorm/repair` 不建"，经全代码 + **全 git 历史**核实**两者皆伪**（`/api/dorm/repair` 从未存在；`af/repair.js` 从未引用 `flow_instance`），报修**全项目仅一个写入端点**；误判根源是仓库里留着**无路由引用的死文件** `src/views/af/RepairView.vue`（旧页面，已 301→/dorm）。② **删死文件**。③ **修文档宣称超出实现**：`RESEARCH-功能架构调研.md` 写"审批流 请假/奖助/报修共用一套"，而 `flow_instance` 实测仅 3 条全部 `biz_type='leave'`（社团申请同为自建状态机）→ `DATABASE.md` 新增**「审批流 vs 状态机」判据表**（处理环节数 / 业务语义 / 留痕需求），ARCHITECTURE ADR-7、RESEARCH、API.md 同步修正答辩口径。④ **补报修工单终态**：原 `status` 只有 0待受理/1处理中/2已完成，师傅发现"非后勤职责/需学生自理"时**无法正确关闭工单**（只能谎报完成或永远挂着）→ 新增 `status=3 无法处理`（**remark 必填**并通知报修人）；后端改为 `FLOW` 表驱动（`from/to/needRemark/msg`），**前置状态写入 `WHERE` + 按 `affectedRows` 判定**，防两名处理人并发越状态流转。⑤ 前端报修处理页加"无法处理"按钮与筛选项、驾驶舱补"报修无法处理"与"请假已驳回"两态统计（学工线四态对称）。⑥ 教训升格为 **HANDOVER 铁律 #34**（模型归属先定再动手 / 文档宣称不得超出实现 / 死代码会制造幽灵问题 / 凡状态机先数清终态）

- 2026-09-21（测试体系补全）：**AUDIT P1-1 四步全落地，`npm run check` 一条命令 = lint → 单测 → 库体检 → 线上 e2e**（355fecc）——① **ESLint**（flat config，规则强度刻意克制：只开错误级，不加格式类规则）首次运行 29 errors **逐条判定后清零**，其中抓到 2 个真问题：`DormView.vue` 残留**死函数** `submit()` 内 `form.saving` 漏 `.value`（`vue/no-ref-as-operand`，与历史 `[object Object]` 同类，因无人调用而未暴露）、`scripts/ops-check.mjs` 的 `timezone:'+08:00'` **违反时间口径**（诊断会偏 8 小时，已改 `'Z'`，该脚本此前从未入库一并补白名单）；另清理 15 处未使用导入/变量、移除 dashboard 一条从未使用的全表 COUNT。② **Vitest 3**（项目为 Vite 5，vitest 5 要求 Vite 6+ 故降级）+ **5 文件 68 用例**：time（UTC 墙钟补 Z 的 8 小时口径，语义断言+本机强断言两级、不依赖执行机时区）、guard（dataScope 三层防线/错误码/令牌）、schedule（选课时段冲突）、dorm-rules（性别约束 + 与原内联实现逐例等价的回归断言）、http（响应结构/body 解析/IP/错误出口）；**写等价性断言时当场抓出真实偏差**：`Number(null)===0` 会把"性别字段缺失"误判成"未知不限制"而**放行分配**，已改严格比较并**专门验证该断言能失败**（避免"永远绿"的摆设）。③ 为使核心规则可测，抽出 **`lib/schedule.js`（时段冲突）与 `lib/dorm-rules.js`（性别约束）** 两个纯函数模块供生产代码调用——原先它们内联在事务闭包里，任何测试都覆盖不到。④ **`scripts/e2e-smoke.mjs` 51 项全过**（取代域名已失效的 smoke-full.mjs）：全部只读 GET 可反复重跑、四角色 + 越权边界（学生打 admin/宿舍总览必须 40301）+ 历史缺陷回归（驾驶舱报修四态、邮箱列表不得下发明文密码）。⑤ 回归验证：线上 e2e 51 项 + 前端 7 页渲染巡检（含骨架菜单 19 项与 active 高亮，确认 PortalShell 的 `defineProps` 改动无副作用）+ 零 console 错误。⑥ 教训升格为 **HANDOVER 铁律 #35**（测试三层分工；加测试三条规矩；ESLint 强度克制的理由）。遗留：devDeps 因 vitest 带入 4 条告警（仅影响本地 dev server），**生产依赖仍 0 漏洞**

- 2026-09-21（登录后自助改密）：**补上"登录状态下自助修改登录密码"这一缺失能力**——用户提问"修改密码的功能做了吗"时核实发现：系统原有三条路径（忘记密码=未登录邮箱验证码、管理员重置他人密码、登录后改**校园邮箱**密码），**唯独没有"登录后改自己的登录密码"**，且 PRD 从未列入计划（只写了"忘记密码双通道"）。① 新增 `POST /api/me/password`：**必须验原密码**（否则会话被劫持后攻击者可直接改密把真实用户锁在门外）→ 新密码 8~64 位且不得与原密码相同 → 更新 bcrypt hash → **吊销该用户全部 refresh token**（改密即视为口令可能已泄露）→ opLog 留痕；原密码错误 10 分钟 5 次限流（DB 流水计数，与登录限流同范式，多实例安全）。② 抽出 **`lib/password-rules.js`** 作为口令强度唯一来源：原先规则以字面量散落三处（注册 `PASSWORD_MIN`／忘记密码内联 `PWD_OK`／管理员重置 `length < 8`），任一处被改都可能造成"某入口能设弱口令"的静默缺口；现已统一并被单测覆盖。③ 前端入口放在**顶栏用户名下拉**（工作台/返回首页/修改登录密码/退出登录），改密成功后清本地会话并回登录页（服务端已吊销，否则界面还显示"已登录"但任何刷新都失败，用户会以为系统坏了）；同时把工作台那个改**邮箱**密码的按钮文案改为「修改邮箱密码」以消除歧义。④ 测试：新增 `tests/unit/password-rules.spec.js`（12 用例，含 7/8/64/65 边界、非字符串输入、中文按字符计、**与重构前字面量规则的逐例等价断言**）→ 单测总数 **68 → 80**；`e2e-smoke.mjs` 补第 8 节「自助改密安全边界」（未登录 40103 / 新密码过短 43701 / 新旧相同 43702 / 原密码错误 43704 或 42900，**全部是"不该成功"的调用故不改动任何账号**，成功路径由单测+人工一次性验证覆盖）。⑤ 错误码新增 43700~43704（API.md 已登记）。⑥ 已知边界（如实记录）：access token 是 2 小时无状态 JWT，吊销 refresh token 后**其他设备最长 2 小时内仍可能持有有效凭证**——要秒级全端失效需引入令牌版本号，当前规模不做

- 2026-10-09（AI 融合定版）：**毕业设计选题确定为 AI 融合方向，选型与实施路径定版**——模型唯一选定 **GLM-4V-Flash**（用户明确：必须 4V 才免费；OpenAI 兼容 `https://open.bigmodel.cn/api/paas/v4`；视觉+文本双模；实测 HTTP 200 / 476ms / JSON 输出正常；上下文 4K）。配置 `AI_GLM_API_KEY / AI_GLM_BASE_URL / AI_GLM_MODEL=glm-4v-flash` 存 `.env`（密钥不入库不入文档）。实施顺序四步：**lib/ai.js 统一出口**（照 lib/notify.js 降级模式，AI 挂了业务照常）→ **驾驶舱意图问数**（优先，答辩演示项：意图分类+参数抽取强制 JSON，SQL 走白名单参数化模板，模型永不拼 SQL）→ **论坛 AI 审核**（4V 视觉+文本，高风险转人工）→ **RAG 校园问答**（可选，TiDB 向量）。完整口径固化为 **ARCHITECTURE ADR-9**，任务清单见本文件阶段 6。另：docs/README 邮件品牌已全量更名 keaidang mail（7eddf74，LANQIN_* 变量名与 lib/lanqin.js 文件名保留兼容）
  > ⚠ **本条中的模型选型（GLM-4V-Flash）与"上下文 4K"已于同日被下一条修订取代，以修订条与 ADR-9 为准。**

- 2026-10-09（AI 选型修订 + 多模态成本红线）：**模型由 GLM-4V-Flash 换为阿里云 qwen3.8-omni-flash，并立下"开发测试期只用文本输入输出、禁碰多模态"的硬约束**（用户指定：多模态计费过高，开发测试期成本敏感）。① **接入实测**：走 DashScope OpenAI 兼容 `https://dashscope.aliyuncs.com/compatible-mode/v1`（**仅国内站可用**，国际站 `dashscope-intl` 返回 401 invalid_api_key）；该 key 实为**聚合网关**——`/models` 返回 **262 个模型**（含 kimi-k3 / deepseek-v4-pro / glm-5.3-prime / qwen3.8-max / MiniMax-M3 等），**不可按阿里云官方文档预期配额与价格**。配置 `AI_QWEN_API_KEY / AI_QWEN_BASE_URL / AI_QWEN_MODEL / AI_PROVIDER=qwen` 入 `.env`（密钥不入库不入文档），GLM 三键保留备用。② **模型能力实测（vs glm-4v-flash）**：`reasoning_content` 为**独立字段**（GLM 把 `<think>` 混进正文需清洗）；**上下文 40 万字 / 206962 token 通过**（GLM-4V-Flash 16384 即报错，此前 ADR-9 记的"4K"实为误记）；RAG 长文检索命中率明显更高（40 篇干扰文档下 qwen 答对、glm-4v-flash 答"未找到"）；"全部批准"能返回**数组**多条（GLM 只回单条）；**强制工具调用**：qwen 关思考后 `auto`/`required` 均可、glm-4v-flash 完全不支持。③ **★ 思考模式开关实测**（同为 qwen3.8-omni-flash）：意图 JSON **4117ms → 669ms（快 6.2 倍）**、completion tokens **229（思考 214）→ 13（降 94%）**，而 reasoning token 按输出计费 → **又快又省钱且准确率 5/5 不变**；**额外解锁工具调用**——思考模式下 `tool_choice: required` 直接报错（`does not support being set to required or object in thinking mode`），关思考后可用。三种关闭写法均生效（`enable_thinking:false` / `chat_template_kwargs.enable_thinking:false` / `thinking:{type:"disabled"}`）。因此定为**硬约束二：思考模式默认关闭**。④ **硬约束一（本次核心）**：**开发测试期禁止任何多模态调用**（不传 image/audio/video、不做 OCR/图片理解/语音/图像生成），连带把 ADR-9 第 3 步「论坛 AI 审核」**降级为纯文本审核**；需媒体能力须另立 ADR 并先定预算。已写入 **ARCHITECTURE ADR-9（选型结论 + 两条硬约束 + 实施顺序）**、**HANDOVER 铁律 #36** 与本文档阶段 6 / 已知坑。⑤ 遗留：**EdgeOne 控制台尚未配 `AI_QWEN_*` 环境变量**（上线前必须补，铁律 #5 env 改了要重新部署）；用户提供的 key 系对话明文，已建议其去控制台轮换

- 2026-10-09（AI 融合开工：P2 知识库 + P3 C1 校园问答上线）：**从"仅设计稿"进入可对话状态**——线上已能用自然语言问校园问题并带出处回答。① **P2 知识库**：`scripts/seed-ai-kb.mjs` 作为唯一数据源（67 条 / 7962 字 / 10 分类，幂等 upsert），自动渲染出 `docs/AI-KB-CONTENT.md`；**修掉一个真实缺陷**——`ai-kb.normalize` 原把 `.` `-` 一律当标点删除，导致 `4.0`→`40`、`2026-2027-1`→`202620271`，改成"夹在字母数字之间才保留"并补测试。实测检索比全量注入省 95% token、TopK=3 命中 20/21，故把 `ai.kb.inline_max_chars` 从 8000 降到 4000 走召回（新增 `ai.kb.top_k` 配置项）。**TiDB 与 MySQL 的 `affectedRows` 语义差异**（INSERT…ON DUPLICATE KEY UPDATE 内容无变化时 TiDB 返回 1、MySQL 返回 0）导致幂等复跑误报"新增 67"，改为先查存在性再决定 insert/update。② **P3 C1 问答**：新增 `lib/ai-variant.js`（能力目录 + 累加式四档分级，**防御式默认拒绝**：`roles` 为空一律不给能力）、`api/ai/status.js`（按角色返回能力/版本/候选问题）、`api/ai/chat.js`（SSE 流式，事件 `meta`→`delta`*→`done`；**校验/限流/上游失败一律用普通 JSON 返回**，前端把 message 当一条助手消息渲染而非报错）、前端 `views/AIView.vue` + `components/AiOrb.vue` + `stores/ai.js` + `api/ai.js`，门户菜单/工作台卡片按能力自动出现。单测 119 → **149**，lint 零告警，构建通过。③ **两条实测新结论**：**EdgeOne Node Functions 支持真流式 SSE**（探测端点 4 个约定 400ms 间隔的分片在客户端逐个到达：392/401/403ms），**平台缓冲风险排除**，C1 走真流式打字机；**兼容网关流式响应自带 `usage`**（无需 `stream_options`，含 `cached_tokens`），token 统计为真值。④ 运维：`.env` 的 `E2E_ADMIN_PWD` 与线上实际密码（admin 于 2026-10-06 经自助改密修改）长期不一致，导致线上 e2e 13 项级联失败，本次同步后 **56/56 全绿**——**教训：凡文档/脚本里出现"演示密码"，改密后必须同步，否则冒烟脚本会给出误导性的失败**。

- 2026-10-09（P3 上线后用户实测反馈 → 定位并修复 1 个真实故障 + 1 个质量问题）：用户在管理员工位实测 AI 问答时贴回 9 轮对话，其中 1 轮出现「智能问答暂时不可用，请稍后再试」，另 2 轮的"参考"里混进了明显无关的条目。**① 真实故障（P0 级，已修）**：直接打线上 `GET /api/ai/status` 复现出 **EdgeOne 502 HTML 崩溃页**（`FUNCTION_INVOCATION_FAILED`，页面明文显示 `ReferenceError - 登录状态已失效，请重新登录`）——根因是**我新写的 3 个 `/api/ai/*` handler 漏了 `try/catch + jsonError`**（全站 44 个 handler 里 41 个都有，唯独这 3 个没有）。`requireRoles` 抛出的 `HttpError` 未被捕获 → 平台换成 502 HTML → 前端既判不出 SSE 也 `res.json()` 失败 → 只显示默认兜底文案，**表面像"AI 服务坏了"，实为鉴权异常穿透**；且状态码是 502 而非 401，前端"401 自动续期"分支根本没进，用户被硬卡住；线上无控制台又不落 `sys_op_log`，无法远程定位。已给 3 个 handler 补包装，并立 **铁律 #37**（Node Functions 每个 handler 必须包装 + 自检命令）。**② 质量问题**：`TopK=5` 只取前 N 个、不判断是否真相关，导致「我是管理员」这类问题把「宿舍分配规则」「交易集市发帖要求」也列为参考；且知识库同一话题存在"短 FAQ + 详细条目"两条（4 组：选课/退课/改登录密码/忘记密码），召回时同时命中 → 分数被劈成两半、上下文翻倍、界面出现两条几乎一样的参考。已加**分数门槛**（`minScore=3` + 相对门槛 `minRatio=0.3`，阈值由 `working/kb-tune.mjs` 在 25 条真实问题 × 67 条库数据上网格搜索确定）与**话题去重** `dedupeByTopic`（近似重复时**保留正文更完整的那条**，而不是分数更高的——短 FAQ 正文常只写"详见《XXX》"，留下它模型反而看不到规则全文）。实测：命中 **25/25 不变**、负例误召回 **0/3**、平均召回 **3.96 → 1.75 条**、4 组重复全部合并。**③ 同时修正了测试自身的标注错误**：原把「学费怎么交」「我是管理员」标为"应无召回"，实测知识库确实覆盖（前者明确写了平台无在线缴费），被召回是正确行为。单测 149 → **161**，lint 零告警，构建通过。

- 2026-10-09（修复 P3 缺陷：**AI 不知道提问者是谁**）：用户在管理员工位实测发现两处不对——① AI 一直把管理员当学生，称呼"同学"、答"如果你是学生…如果你是辅导员…"；② "查看所有待审批的请假"只给步骤不执行。**② 属能力缺口**（对话式执行 = C5，排 P6，且需先做 P4 服务层让 AI 与人工共用鉴权/审计；按 ADR-9 走"预览→一次性确认令牌→执行"两阶段，不会一句话就执行破坏性操作），**① 是我的实现缺陷，本次修**。**根因**：`api/ai/chat.js` 的 system prompt 只有「回答纪律 + 平台档案 + 检索资料」，**提问者身份一个字都没进去**——`variant`（角色版本）明明算出来了，却只塞进 SSE 的 `meta` 给前端，没进 prompt；且第 3 条还写着"像学长学姐答疑"，两处同时把模型往"学生助手"人格上带。**修复**：新增 `lib/ai-identity.js`（`loadIdentity` 只读本人姓名/账号/部门；`ROLE_SCOPE` 写死五角色的**真实**能力边界与数据范围，与 PortalShell MENUS / WorkbenchView BY_ROLE 同源核对；`identityBlock` 生成身份提示块），chat.js 把它插在**规则之后、知识之前**（优先级高于资料）。身份纪律五条明确写入：称呼按角色（只有学生叫"同学"）、先判能力范围再直答、**严禁**"如果你是X…如果你是Y…"并列假设式回答、按数据范围作答、不透露他人信息。**同时修掉一个自相矛盾**：`identityBlock` 原用 `roles[0] || 'student'` 兜底，会让"角色：未知"和"范围=学生"同时出现，改为显式退化为"未知，按最保守处理"。单测 161 → **172**（新增 `tests/unit/ai-identity.spec.js` 11 项），lint 零告警。

- 2026-10-09（**P4 服务层重构**）：抽 `node-functions/lib/services/{_actor,users,leave,notice,forum}.js`，4 个 handler（admin/users 380 行、forum/threads 233、af/leave 163、af/notice 98）改为 HTTP 薄壳。**动机**：改造前权限校验/SQL/审计全写死在 handler 里，AI 无法复用 —— 要么重复实现（两套权限必然漂移），要么让 AI 直接拼 SQL（ADR-9 禁止）。现在**人工点按钮与 AI 对话触发走同一份权限与审计**。关键约定：① `actorFrom(context)` 是构造 Actor 的唯一入口（漏传 roles/deptId 会让权限判断静默失效，两种都极难在测试里发现）② 业务错误一律 `throw HttpError`，handler 的 `jsonError` 原样转成 `{code,message}`，**与改造前逐字节一致** ③ 数据范围刻意复用 `guard.js` 的 `dataScope()`，不另写一份 ④ 校验顺序刻意保持原样（公告 pin 先"是不是自己的公告"再"是不是管理员"，顺序反了提示会指向错误操作）。**验证：线上 e2e 56/56 全绿（零回归）**。确定性修复：公告 pin 原先未留痕，补上 opLog。单测新增 11 项（角色默认拒绝、`via:ai` 标记、有效期时区换算）。
- 2026-10-09（**P5 C2 论坛 AI 审核员 + C3 四类异常告警邮件**）：`lib/ai-review.js` 做同步判定 + **3s 硬上限**（`aiJson` 解析失败会重试一次，故外层再套 Promise.race 兜死；超时/失败 → 放行 + `review_status=1`，宁可事后复核不能卡住发帖）；判定结果落 `ai_review_log`，输出经 `normalizeVerdict` 规范化（非法 verdict 降级 suspect、分类过白名单、置信度夹到 [0,1]）。审核钩子挂在**服务层** `onBeforeInsert`，但服务层本身不依赖 AI（关掉时零开销）。C3 四类告警源全部接入：`content_violation`/`system_500`/`ai_failure`/`login_bruteforce`，各自带去重键。新增 `/api/ai/review`（仅超管）做人工复核队列与处置（确认违规→软删+可选禁言；误判→放行），全部落 `sys_op_log`，可统计"AI 判了多少、人工纠正了多少"。**★ 关键修正：`jsonError` 与 `logAiError` 改为 `await` 告警** —— Serverless 不保证响应后后台 Promise 还会跑完，fire-and-forget 会**丢告警**（表现为"日志说该告警但邮件从没发出"）。**线上验收 7/7**：违规帖（代写代考）被拦 `49006`、正常帖通过、`ai_review_log` 两条留痕、告警邮件成功发往 admin@keaidang.com、学生访问队列 40301。
- 2026-10-09（**P6 C5 管理员智能管理**：对话式执行系统操作）：落地用户诉求"这种指令应该帮我执行而不是告诉我步骤"。`lib/ai-actions.js` 是**全项目唯一能产生写操作**的地方，四条安全底线：① 白名单（模型只能输出注册表内的 key，永不生成 SQL、永不直接执行）② **范围必须显式**（批量必须 `all:true` 且带 role/keyword，只给模糊描述时拒绝执行并引导 —— 防"一句话把全校禁了"）③ **两阶段确认**（第一次只返回影响清单 + 确认令牌，一行数据都没改；令牌 = JWT HS256、5 分钟、`audience=ai-confirm`、**绑定操作者 sub**；执行前重新解析目标，如实反映"确认期间状态已变"）④ 落到服务层（与人工同一套权限与审计，审计 detail 带 `via:ai`）。11 个动作按角色可见（学生与校领导**零动作**）。`api/ai/action.js` 单次调用兼顾"执行指令"与"回答问题"（解析不出动作就用同一份知识库答掉，避免管理员问普通问题付两次费）；为此把回答口径抽成 `lib/ai-prompt.js` 供 chat.js/action.js 共用。前端支持三种结果：结果表 / 确认卡（影响清单 + 跳过原因 + 警告 + 二次确认）/ 普通回答。**线上验收过程中修掉 4 个真实缺陷**（见下条）。
- 2026-10-09（P6 验收暴露并修复的 4 个缺陷，全部有线上证据）：① **`Body is unusable: Body has already been read` 穿透成不透明 500**——查库发现这是**平台长期行为**（自 2026-09-17 项目第 2 天起累计 37 次，与业务耗时无关），改为 `readBody` 单独捕获 → **49406 / HTTP 503 + 落 `sys_op_log(action='error.bodyUnreadable')`**，前端对非 GET 5xx 本就自动重试一次 → 用户无感恢复。② **C5 目标解析"看不到"新建账号**：原实现是"拉一页（limit 200）再内存筛名字"，而库有 500+ 账号、`findUsers` 按 id 升序分页 → 新建账号永远落不进那一页 → 预览恒为空。新增 `findUsersByNames()` 走 SQL IN 精确匹配。**教训：分页查询+内存过滤当精确查找用，超过一页必然出错，且只在新建数据上暴露**。③ **确认清单全是 null**：解析结果只有 username/real_name 而前端渲染 `label` → 二次确认形同虚设，补 `withLabel()`。④ **AI 写操作未打 `via:ai`**：`actorFrom()` 没设 `viaAi`，铁律 #4 落空。另：`aiJson` 新增 `totalBudgetMs`（原最坏 2×timeoutMs 会顶到平台函数超时，触发平台重试 → 又撞上缺陷 ①）。**线上验收 15 项：两阶段确认完整跑通（预览不改数据 → 确认 → 真执行 status=0）、令牌重放/跨用户/越权降级全部拒绝、危险意图不被执行、`via:ai` 审计可见**。

- 2026-10-09（**P7 C4 审批助手 + C6 信息问数**）：**C6 问数** `lib/ai-insight.js` 建 10 个模板（各班请假排名/各院系请假排名/请假总览/选课 TOP/成绩分布/宿舍入住率/报修四态与时长/论坛活跃度/账号统计/登录趋势）。**核心安全设计：模型永远不接触 SQL** —— 只做"选模板 + 抽参数"，参数再过 enum 白名单（时间窗口只允许 `7d/30d/180d/all`），由服务端参数化执行；实测两次注入尝试（`1 YEAR`、`period=7d' OR 1=1 --`）分别被 49402 拦下与安全退化成回答，数据完好。时间口径刻意用 `NOW() - INTERVAL ? DAY` 且参数标注为「近 7 天」而非「本周」，避免自然周语义歧义。**C4 审批助手** `lib/ai-approval.js`：**没有任何写操作**（不碰 af_leave/flow_node），输入是服务端组装的**事实**（本单 + 该生近 30 天请假次数天数 + 请假时段内**有课冲突**的教学班清单），让模型基于事实说人话而不是自己"猜"风险点。前端 `/af/approve` 在审批对话框内显示建议卡（建议/置信度/风险点）+「采纳理由到意见框」，并明写"最终决定权在你 —— AI 不参与审批"。接口编排：管理员的 `api/ai/action.js` 解析提示词一并带问数模板 → **一次调用同时支持"执行/问数/问答"**；校领导走独立 `api/ai/insight.js`；前端按 actions → insights → chat 选路。**线上验收 20/20**：5 个问数模板全部正确命中并返回数据、注入尝试被兜住、学生问数 49403、审批助手给出建议且**未改动单据状态**、学生取建议 49403。
- 2026-10-09（★ **AI 帮我抓到了我自己代码里的一个真 bug**）：P7 验收时 AI 的建议文本里出现「请假时长显示为'约 NaN 天'，系统计算异常」与「提示'该时段内没有已选课程'」。根因：**mysql2 会把 `DATETIME` 返回成 Date 对象**（且按连接时区 +08:00 解析），而 `weekdaysInRange` 按字符串解析 → `String(Date)` 得到 `"Fri Sep 18 2026 …GMT+0800 (中国标准时间)Z"` → Invalid Date → **静默返回空数组** → "请假期间有课冲突"被算成"没有课"，**结论完全反了**。**危害等级**：这不是"少显示一块数据"，而是把"系统算不出来"伪装成"学生没课"，等于给出与事实相反的审批依据。修复：① SQL 侧统一 `DATE_FORMAT(x,'%Y-%m-%d %H:%i:%s')` 取字符串，消除 Date 对象的时区歧义（与铁律 #25 的"库内 UTC 墙钟"口径一致）② 新增 `parseUtc()`，**只接受墙钟字符串，其它输入一律 null**（不再悄悄给错值）③ `collectFacts` 增加 `timeParseable`，解析失败时事实文本明确写「⚠ 时间字段无法解析，**无法判断时段内是否有课冲突**（请人工核对课表）」—— **宁可说"不知道"，也绝不输出"没有课"**。**意义**：这是"让模型基于事实说话"的直接收益 —— 事实自相矛盾时模型会指出来，而纯生成式的做法只会顺着错数据编。

- 2026-10-09（**P9.1 AI 管理控制台**，优先于 P8 做）：`views/admin/AiAdminView.vue`（仅超管，`/admin/ai`）+ 三个接口 `api/ai/{config,kb,usage}.js`，五个 Tab：**功能开关**（22 项 `ai.*`，布尔项直接开关，改完约 30 秒生效、无需重新部署）、**审核队列**（C2 待复核 → 确认违规/误判放行）、**知识库**（列表/搜索/分类/启停/删除，并明确提示"唯一数据源是 seed 脚本，此处改动会被覆盖"）、**告警记录**（C3 发送留痕与去重依据）、**用量统计**（按 kind 的调用数/token/耗时/成功率 + 最近调用明细，论文数据直接取这里）。**为什么这个页面必须先做**：C2/C3/C4 等新 AI 能力按决策**默认关闭**，在控制台出现前，管理员只能改数据库才能打开它们 —— 它是一切 AI 能力的"总闸"。

## 下一步

> 详细剩余项与整改建议已收敛到 **docs/AUDIT-2026-09-21.md**（2026-09-21 全面体检报告，含 P0~P2 分级与工作量估计），此处不再重复维护（避免漂移）。

- **[ ] AI 融合实施（2026-10-09 选题方向定版 + 同日修订选型，当前最高优先）**：模型 **qwen3.8-omni-flash**（阿里云 DashScope 兼容网关，实测上下文 40 万字、`reasoning_content` 独立字段，已连通验证）。按 ARCHITECTURE ADR-9 顺序：lib/ai.js 统一出口 → 驾驶舱意图问数+管理员辅助 → 论坛 AI 审核（纯文本）→ RAG（可选）。**两条硬约束：① 开发测试期只用文本、禁多模态；② 思考模式默认关**。硬约束与降级要求见 PROGRESS「已知坑」AI 条目与 HANDOVER 铁律 #36
- **[x] 移动端 H5 适配**（2026-09-20 完成）；小程序已决策不做（PRD §4 + ARCHITECTURE ADR-8）
- **[ ] P0（对外前必做）**：演示账号 `admin/admin` 改强密码，并从文档移除明文（见 AUDIT P0-1）
- **[ ] P1（工程护栏，最值得先做）**：把已有冒烟脚本固化成一条 `npm run check`；再逐步补 ESLint 与关键路径单测（见 AUDIT P1-1）
- **[ ] P1**：统一报修口径（纯文档，20 分钟，见 AUDIT P1-2）/ EP 按需引入 / 图片图床
- **[ ] P2**：图书封面、邮箱附件、学期口径、监控告警、备份演练、App 壳打包（测试账号 zhreg2871 已于 2026-10-07 停用处理）

