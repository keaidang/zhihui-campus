# HANDOVER · AI/开发者交接文档

> 最后更新：2026-10-09。**新会话/新 Agent 开工前必读本文档**，再按需读 docs/ 其他文档。
> 一句话现状：智汇校园已上线 https://c.9o.pw/ ，认证 + 五角色 RBAC + M1 教务线 + M2 学工线 + 校园邮箱体系 + M3 生活服务五模块（图书借阅/失物招领/社团活动/校园论坛/忘记密码）+ **M4 数据驾驶舱/宿舍管理/站内信** 全量可用，演示数据齐全；**AI 融合方向已定版待实施**（模型 **qwen3.8-omni-flash**（阿里云 DashScope 聚合网关），四步路径，唯一口径见 ARCHITECTURE ADR-9，2026-10-09）。**⚠ 开发测试期 AI 只用文本输入输出，禁碰多模态（贵）——见铁律 #36。**

## 1. 项目快照

| 项 | 值 |
|---|---|
| 项目 | 智汇校园 —— 一站式智慧校园服务平台（毕业设计） |
| 论文标题（定稿） | 《基于云边协同与 Serverless 架构的"智汇校园"一站式服务平台设计与实现》 |
| 线上地址 | **https://c.9o.pw/**（EdgeOne Pages，git push 后约 2.5~3 分钟自动部署；旧地址 campus.keaidang.com 仍可用） |
| 仓库 | github.com/keaidang/zhihui-campus（main 分支） |
| 技术栈 | Vue3 + Element Plus + Pinia（前端）/ EdgeOne Node Functions（业务 API）/ TiDB Cloud Serverless（MySQL 8.0 兼容）/ keaidang mail 开放 API（邮件） |
| 虚拟学校 | 清北大学（校徽 public/logo.webp、书法校名 public/name.webp）；页脚备案 苏ICP备2026056678号 · 鲁ICP备2025186072号 并列 |
| 本地路径 | `C:\Users\Administrator\Desktop\zhihui-campus` |

## 2. 演示账号（TiDB 里真实存在）

| 账号 | 密码 | 角色 | 备注 |
|---|---|---|---|
| **admin** | 见 `.env` 的 `E2E_ADMIN_PWD` | admin+student | 超管。**2026-09-22 经自助改密功能已改为强口令**（原 `admin/admin` 失效）。口令**刻意不写进本文件** —— 本文件入库即公开，明文口令就是 AUDIT 里的 P0 缺陷。本地脚本（`e2e-smoke` / `make-readme-shots`）会自动从 `.env` 读取，无需手动传参 |
| teacher01 | Zhihui@2026 | teacher | 王志远 T2001001，任教 3 个教学班 |
| counselor01 | Zhihui@2026 | counselor | 刘慧敏，计算机学院（本院数据范围） |
| student01 | Zhihui@2026 | student | 陈晓东 20261001，**已有选课+92 分成绩数据，勿清库** |
| student02 / student03 | Zhihui@2026 | student | 林小雨 / 赵子墨 |
| student004 | Zhihui@2026 | student | **M3 主测试号**：有借阅记录、AI 兴趣社 1 条预约、论坛发帖；社团预约数据已打散，其余社团可直接预约 |

> **口令管理约定**：演示/测试口令只允许放在 `.env`（已 gitignore）或控制台环境变量，**严禁写入 `docs/` 下任何文件**（docs 随仓库公开）。新增需要口令的脚本时，统一走 `process.env` + `.env` 兜底（参考 `scripts/e2e-smoke.mjs` 的 `loadDotEnv()`）。

- 建号/授权/重置密码：`& node.exe scripts/grant-role.mjs <user> <role> [--create] [--reset] [--name=姓名] [--no=学号]`
- SQL 迁移：`& node.exe scripts/migrate.mjs database/schema-NNN-*.sql`（幂等，可重复跑）
- **当前学期口径 `TERM='2026-2027-1'`** 硬编码在 edu 相关 API，换学期需统一修改
- 邮箱测试账号：zhreg2871（RegTest@2026，校园邮箱 zhnewuser94@keaidang.com，已开通对外收发）——确认无用后可删除

## 3. 代码地图

```
├─ docs/                      # 文档（单一事实来源，先改文档再改代码）
├─ database/                  # schema-001~008（auth/base/edu/affair/org/行政部门/校园邮箱/发件表）+ 009-m3-modules（M3 十一表）+ 010-dorm（宿舍）+ 011-message（站内信）
├─ node-functions/
│  ├─ lib/                    # db.js(连接池+瞬时错误重试，query()直接返回rows) http.js guard.js auth.js lanqin.js(邮件API封装)
│  │  ├─ ai.js                # ★ AI 统一出口（qwen3.8-omni-flash；aiUpstream/aiChat/aiJson + 总开关守卫 + 上游错误分类）
│  │  ├─ ai-config.js         # 运行时开关与阈值（sys_config，改完约 30 秒生效，无需重新部署）
│  │  ├─ ai-guard.js          # 频控（DB 流水计数 + 在途标记补 check-then-act 窗口）
│  │  ├─ ai-entity.js         # ★ C13 实体字段注册表（6 实体；SQL 片段只存服务端，给模型只给语义层）
│  │  ├─ ai-query.js          # ★ C13 查询编译器（把结构化描述编译成参数化 SQL，六条安全边界）
│  │  ├─ ai-actions.js        # C5 白名单操作注册表（11 个动作，模型只能选 key）
│  │  ├─ ai-insight.js        # C6 问数模板库 + C13 实体目录渲染（entityPromptSections）
│  │  ├─ ai-kb.js / ai-prompt.js / ai-identity.js / ai-variant.js   # 知识注入 / 提示词 / 身份档案 / 分级配色
│  │  ├─ ai-review.js / ai-triage.js / ai-summary.js / ai-lf-match.js / ai-anomaly.js / ai-lib-search.js / ai-study.js / ai-approval.js
│  │  ├─ sse.js               # SSE 流式封装（openAiToEvents / pipeUpstreamWithTap，含流中断收尾）
│  │  └─ alert.js             # C3 告警通道（邮件，HTML 已转义）
│  └─ api/
│     ├─ auth/                # register(+send-code/prefix-check/domains) login refresh logout me + password/(forgot-send-code/forgot-reset 忘记密码)
│     ├─ admin/               # meta users(+resetPassword) departments classes courses mailbox(开通/停用/改密/改地址)
│     ├─ mail/                # index(收件列表/发信/已发送) detail
│     ├─ me/                  # mail-password(用户自助改邮箱密码)
│     ├─ blob.js              # 图片 blob：POST base64≤3MB → sys_blob；GET ?token= 公共只读 ← M3
│     ├─ edu/                 # course timetable score teach   ← M1 教务线
│     ├─ af/                  # leave repair notice             ← M2 学工线
│     ├─ lib/                 # books(检索/管理/批量导入) loans(借/还/我的借阅)   ← M3
│     ├─ lf/                  # items(失物招领发布/浏览/关闭)                     ← M3
│     ├─ club/                # apply(申请/审批) recruit(发布/预约/取消)          ← M3
│     └─ forum/               # boards threads(发帖/回复/置顶/锁定) moderate(封禁) ← M3
│     ├─ dorm/                # index(楼栋/房间/住宿分配 assign 事务+性别约束) ← 宿舍管理
│     ├─ notice/              # messages(站内信列表/已读/发送/广播) ← schema-011
│     └─ admin/dashboard.js   # M4 驾驶舱聚合（admin/leader 只读）
│     └─ ai/                  # ★ AI 端点：status 能力清单 · chat C1 问答(SSE) · action C5 两阶段执行(含 C13 query) · insight C6/C13 问数
│                             #   study C7 · lib-search C12 · anomaly C11 · review C2 审核队列 · approval-advice C4
│                             #   config/kb/usage/eval 管理控制台 · stream-probe 流式探测
├─ edge-functions/            # KV 诊断位（kv-check 等）
├─ src/
│  ├─ api/request.js          # 统一请求封装（Bearer + 401 自动刷新重放）
│  ├─ stores/auth.js          # Pinia：双令牌，accessToken 仅内存；restoreSession/tryRefresh 单飞 Promise（防 F5 竞态）
│  ├─ router/index.js         # 路由 + 登录/角色守卫（redirect 回跳；M3 五路由均 requiresAuth）
│  ├─ mobile.css              # ★ 移动端适配层：只含 max-width:820px 媒体查询（PC 零影响，见铁律 #27）
│  ├─ utils/device.js         # useIsMobile()：matchMedia 视口检测（断点须与 mobile.css 同值）
│  ├─ utils/time.js           # 时间展示唯一入口 fmtTime/fmtAgo（见铁律 #25）
│  ├─ components/PortalShell.vue  # 门户骨架 + 实景背景 + 按角色菜单 + 移动端汉堡/抽屉(v-if=isMobile)
│  ├─ components/ImgUploader.vue  # 图片上传：canvas 压缩 1280px/JPEG 0.85 → POST /api/blob，v-model 数组
│  └─ views/
│     ├─ HomeView.vue         # 门户首页（SSO 联动）
│     ├─ LoginView.vue        # 登录/注册一体：注册带邮箱验证码 + 校园邮箱前缀 + 域名后缀下拉
│     ├─ WorkbenchView.vue    # 工作台：账号卡 + 功能矩阵 + 校园邮箱卡 + 常用资源横排
│     ├─ MailView.vue         # /mail 收发件页（收件箱/已发送/详情/写邮件，lucide 图标）
│     ├─ m3/                  # LibraryView LostFoundView ClubView ForumView ForumThreadView ← M3
│     ├─ dorm/DormView.vue    # /dorm 宿舍管理：学生=我的宿舍+报修；staff=楼栋房间网格+分配
│     ├─ MessageView.vue      # /messages 消息中心 + staff 撰写（PortalShell 顶栏铃铛 60s 轮询未读）
│     ├─ admin/               # UserManageView（含邮箱管理/僵尸筛选/CSV 导出） StudentManageView OrgManageView CourseManageView
│     ├─ edu/                 # ElectView ScoresView TeachView ScoreEntryView
│     └─ af/                  # LeaveView ApproveView RepairView RepairManageView NoticeView
└─ scripts/                   # migrate.mjs grant-role.mjs seed-demo.mjs seed-admin-staff.mjs seed-m3.mjs seed-dorm.mjs cleanup.mjs（白名单制）
```

### 校园邮箱体系（2026-09-20 上线，关键口径）

- **注册**：外部邮箱收 6 位验证码（10 分钟有效，SQL 侧 `expires_at > NOW()` 判过期；60s 重发/每邮箱日 10 封/每 IP 日 20 封）。可选填校园邮箱前缀（默认学号/工号），域名后缀下拉从 `/api/auth/register/domains` 实时拉取（keaidang mail 6 个 active 域名，后端白名单校验），默认角色学生
- **开通**：管理员在账号管理页"开通对外收发"才调 keaidang mail 创建真实邮箱（`createMailbox` 带 `userId=LANQIN_OWNER_USER_ID` 归属主用户），随机密码管理员可见/可导出 CSV，用户在工作台自助改密
- **收发**：/mail 页收件箱（keaidang mail messages，cursor 分页）+ 已发送（本地 `sys_mail_sent` 表）+ 写邮件（每日 50 封限额）；发信统一用 system@keaidang.com；已发送状态对 queued/sending 记录用 GET /send/{id} 实时回查（模块级 Map 60s 节流、单次最多 8 封）
- **发件归属铁律**：keaidang mail POST /mailboxes 不传 userId 会把邮箱挂到自动新建的独立用户 → /send 404 "mailbox not found"。归属修复前开通的旧邮箱连 messages 也 404，需删旧邮箱 + 重置 mail_mailbox_id 重新 enable
- keaidang mail GET /send 历史列表接口常超时，已弃用；验证发件最可靠的方式是直接发真实邮箱看原文

### M3 生活服务（2026-09-20 上线，关键口径）

- **角色映射**：图书馆管理员=admin（/library 管理后台 Tab）；学工处=counselor（失物招领发布）；教务处=teacher（社团审批）；论坛管理员=admin（置顶/锁定/删帖/禁言）
- **图书**：借期 30 天、在借≤5 本、同书不可重复借；库存扣减一律条件更新 `available_copies > 0`；批量导入 CSV/JSON（ISBN 去重）；`lib_book.ext_source/ext_id` 预留外部图书馆系统对接
- **社团预约**：`club_booking` 唯一键 `(recruit_id,user_id)`，预约=激活占位+名额条件更新，取消=释放；quota=0 不限名额
- **⚠️ club_recruit 表没有 location/activity_time 字段**（在 club_application）：join club_recruit 取地点/时间必须再 join club_application——曾致 scope=mine 恒 500（c8341f8 已修）
- **社团测试数据已打散**：seed 早期把预约都给了 students.slice(0,taken0) 同批前排学生，已用 fix-club-bookings.mjs 随机分到全体 400 学生（student004 仅 AI 兴趣社 1 条）；勿再重跑旧版 seed 的预约段
- **论坛**：所有 /api/forum/* 需登录（合规要求）；交易板块发帖 item_name/price/contact 必填；封禁走 `forum_ban`，发帖/回复前校验
- **图片**：`/api/blob`（POST base64≤3MB → LONGBLOB 暂存，GET 公共只读带 immutable 缓存）；前端统一 `ImgUploader` 组件（canvas 压缩到 1280px/JPEG 0.85）；接图床时只改 blob.js 与 ImgUploader 的 URL 生成
- **忘记密码**：登录页对话框 → `POST /api/auth/password/forgot-send-code`（账号+绑定邮箱匹配才发码，purpose='reset'）→ `forgot-reset`（校验后重置 + 删 sys_refresh_token 吊销全部会话）
- **测试数据**：`node scripts/seed-m3.mjs`（幂等）：420 本藏书 / 失物 8 条 / 社团 6 通过+2 待审 / 论坛 30+ 帖；图片抓 picsum 失败自动生成 SVG 占位图存 sys_blob
- **宿舍管理**（schema-010）：原独立"宿舍报修"入口已并入 `/dorm`（/af/repair 路由 301 → /dorm；旧 `RepairView.vue` 已于 2026-09-21 删除——它是**无引用的死文件**，曾导致"报修有两个入口 / 两条写入路径"的误判）；分配=事务 FOR UPDATE + **性别楼栋约束**（sys_user.gender 0未知/1男/2女 ↔ dorm_building.gender）+ **生成列 active_flag 唯一键**保证一人一条在住；occupied 冗余计数必须与分配/退宿同事务维护
- **报修工单模型**（2026-09-21 定口径，铁律 #34）：**单节点状态机，不建 flow_instance** —— 全项目唯一写入端点 `/api/af/repair`（学生 /dorm 提交与查看、staff /af/repair-manage 处理）。状态机：`0 待受理 → 1 处理中 → 2 已完成`；`0/1 均可 → 3 无法处理`（终态，**remark 必填**并通知报修人，用于"非后勤职责 / 需学生自理"等无法完成的场景）
- **站内信**（schema-011）：sys_message 单表（sender_id=0 系统、biz 标来源业务）；发送统一走 lib/notify.js（notify/notifyMany/roleUserIds/allUserIds，尽力而为失败不阻断）；已接线：请假审批结果、社团审批结果、报修受理/完成；前端 PortalShell 铃铛 60s 轮询 /api/notice/messages
- **驾驶舱**（M4）：/api/admin/dashboard 一次 GET 并发 21 条聚合查询（admin/leader 只读）；前端 DashboardView 全 CSS 图表零依赖；页面 /dashboard + 菜单仅 admin/leader 可见
- **宿舍数据**：`node scripts/seed-dorm.mjs`（幂等）：性别确定性补齐（user_id 奇偶，男201/女202）→ 384 间房 → 全体学生按性别入住（403/1728 床，集中住满、留空房演示分配）

## 4. 五角色与页面权限（已定稿，勿动摇）

| 角色 | 主题色 | 菜单/能力 |
|---|---|---|
| student | 统一学术风 | 选课、成绩课表、请销假、宿舍管理（我的宿舍+报修）、公告、消息中心 |
| teacher | 统一学术风 | 我的课程、成绩录入、公告发布（本院）、站内信发送 |
| counselor | 统一学术风 | 请假审批（本院）、宿舍管理+报修处理、学生名册（本院）、公告、站内信 |
| leader | 统一学术风 | **数据驾驶舱（只读大屏）**、公告、消息中心 |
| admin | 统一学术风 | 全部 + 用户/角色管理独占 + 全校广播 + 驾驶舱 |

- **视觉方向（2026-09-18 用户定稿）**：不再按角色区分主题色，全站统一"学术深蓝 #17325c + 素金 #c8a35f 点缀 + 玻璃拟态卡片"，校园实景背景清晰透出；角色仅以文字徽标呈现
- 旧 `--role-accent` 机制已移除（PortalShell/WorkbenchView）；新 CSS 变量：--zc-gold、--zc-glass、--zc-glass-border（核对 :root）
- 角色判定三层：前端路由守卫（体验）→ guard.js requireRoles **实时查库**（真权限）→ dataScope SQL 层强制拼接（数据范围 self/dept/all）

## 5. 必须遵守的铁律（全部踩过坑）

1. **TiDB Serverless 禁用 mysql2 `execute()`（预编译协议）**：代理偶发 malform packet error。全项目统一 `db.js query()` 文本协议
2. **db.js query() 内置瞬时错误重试**（ECONNRESET/malform/握手/SSL，换连接最多 2 次）+ 连接池 5；**withTransaction 事务封装同样内置瞬时错误重试**（换新连接最多 2 次，要求业务幂等——选课/退课满足）—— 随机 500 的根治方案，**别删**
3. **500 会落库 sys_op_log(action='error.500')**，线上无控制台时用这个远程诊断真实错误
4. **新业务模块统一走 guard.js**：requireRoles + dataScope + HttpError + opLog（管理写操作必须审计留痕）
5. **JWT_SECRET 必须在 EdgeOne 控制台配置且选生产环境**；env 变量改后必须重新部署才生效
6. **背景层 z-index:-1 时 body 绝不能有不透明背景**（CSS 绘制顺序会盖住它）；CSS 变量只用未定义会静默失效，新增 var 引用必须核对 :root
7. **防超卖范式**：事务内先 `INSERT ... ON DUPLICATE KEY UPDATE` 选课记录（唯一键占位；退课记录重激活，已出分记录不可重选）→ 再条件 `UPDATE ... WHERE enrolled < capacity`，affectedRows=0 即名额满/重复选课
8. **DATETIME 一律传 Date 对象或 'YYYY-MM-DD HH:mm:ss' 字符串**，禁止 toISOString()（UTC 8 小时偏移坑）
9. KV 60 秒最终一致 → 选课名额等强一致计数一律走数据库
10. **gitignore 白名单制**：根目录 `/*.txt` 与 `node-functions/*.txt` 全忽略，scripts 只保留白名单——调试产物严禁入库
11. **db.js query() 直接返回 rows**，不能按 mysql2 原生 `[rows]` 解构
12. **DATETIME 过期判断放 SQL 侧**（`expires_at > NOW()`）：TiDB 服务器时区 vs Node UTC，JS 里比较会误判
13. **keaidang mail POST /mailboxes 必须带 userId**（LANQIN_OWNER_USER_ID env），否则发件 404 归属失败；LANQIN_* 密钥在 .env 与 EdgeOne env，严禁入库
14. **窄卡片里禁止用 `el-input` 的 `#append`/`#prepend` 插槽**：Element Plus 会渲染成 `display:table` 的 `.el-input-group`，在 ~340px 内容区里追加按钮会把输入区挤到只剩几十像素。统一用「输入框与按钮/下拉做兄弟节点」的 flex 行布局（见 LoginView.vue `.field-row`），并覆盖 `.gate-card .el-button` 的全局 6px 字距
15. **前缀校验接口耗时 4~10s**（后端要查 keaidang mail 邮箱列表），前端不做逐字自动校验，仅"检查可用性"按钮显式触发 + 前端 14s 超时兜底；注册提交本身不依赖该校验结果（后端注册时会再校验）
16. **验证线上部署别只比 bundle hash**：EdgeOne 构建环境与本地不同，同一份代码 hash 可能不一致。可靠做法是取线上对应懒加载 chunk（路由组件是独立文件，不在 index 主包），grep 新版代码的特征类名/字符串（注意构建产物中中文会被转义成 \uXXXX，用 ASCII 类名如 field-row 最稳）
17. **EdgeOne node functions 不支持路径参数**：`/api/xx/<id>` 落回 SPA 返回 index.html——动态参数一律用查询串（`/api/blob?token=xxx`）
18. **EdgeOne POST body 缺键偶发 "Body has already been read" 500**：服务端先把缺失键归一化（`?? '' / null`）再校验；前端表单始终发全量字段
19. **写 SQL 前对照真实 DDL 引用字段**（尤其跨表 join）——club_recruit 无 location/activity_time 曾致 scope=mine 恒 500；新 GET 分支冒烟要覆盖每一条查询路径，不能只测写操作
20. **M3 图片一律走 /api/blob**：POST base64≤3MB 存 sys_blob，GET ?token= 公共只读；URL 必须匹配 `/^\/api\/blob\?token=[a-z0-9]{16}$/`（存量数据已从此前的路径式迁移）
21. **v-html 必须过 DOMPurify**：用户/外部内容（邮件正文等）渲染前消毒（MailView.vue 先例）；全站其余内容一律纯文本渲染，新增 v-html 前先想安全
22. **运维清理**：login.js 登录成功 5% 概率顺带清过期刷新令牌；blob/登录日志用 `node scripts/cleanup.mjs`（默认 dry-run，--yes 执行，参数 --blob-days/--log-days）
23. **★ EdgeOne Node Functions 多实例内存不共享——内存计数限流/锁定无效**（2026-09-20 实测 30 连发零触发，登录锁定同病）。有效限流一律走 DB 流水计数。**且 Node 侧 x-forwarded-for 是 EdgeOne 出口代理池 IP（会在多个代理 IP 间交替），不是真实客户端 IP**——按 IP 计数会被代理池稀释，防撞库必须按"账号"维度：登录=sys_login_log 失败流水（**账号 5 失败/min 防撞库**、出口 IP 60 失败/min 辅助）、忘记密码发码=sys_email_code（3 次/hour/IP）、注册=既有 DB 频控；刷新端点不做频控（一次性轮换+重放检测已足够）。内存锁（isLocked/registerAllowed）仅作纵深防御保留
24. **★ EdgeOne 边缘函数 fetch 子请求不进函数路由**：同域子请求走"节点缓存→静态源站"（返回静态资源/SPA 回退），跨域行为未文档化——**Edge Functions 无法代理转发到 Node Functions**，"边缘网关代理"架构在本平台不可行（2026-09-20 实测后回滚）。边缘侧只放无 DB 依赖的原生轻端点（/api/edge/stats、/api/kv-check）；需要业务数据的能力一律落 Node
25. **★★ 时间口径铁律（2026-09-20 实测确认，改时间相关代码前必读）**
   - **库内一切时间都是 UTC 墙钟**：TiDB 会话时区 `@@system_time_zone='UTC'`，业务写库全用 `NOW()` → 落库即 UTC。核对方法：`SELECT DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s')` 比北京时间**早 8 小时**即正常。
   - **Node Functions 的 mysql2 连接 `timezone` 必须是 `'Z'`**（lib/db.js）。曾误配 `'+08:00'`：mysql2 把 UTC 墙钟按北京墙钟解读，Date 对象整体**早 8 小时**，连带 JSON 输出、Node 侧过期比较、60s 频控全部偏移（那时 60s 频控实际失效、刷新令牌多活 8 小时）。
   - **展示层唯一入口 `src/utils/time.js` 的 `fmtTime()` / `fmtAgo()`**：把真实瞬时转成浏览器本地时区。**禁止**再写 `String(x).replace('T',' ').slice(0,16)`（那是 UTC 墙钟直显，早 8 小时，且字段名驼峰/蛇形不一致时直接 undefined——驾驶舱"时间乱了"就是这么来的）。
   - **Node 侧导出/格式化**（CSV 等）手写格式化时必须带 `{ timeZone: 'Asia/Shanghai' }`，否则在 UTC 运行环境里输出 UTC 时间。
   - **库内比较一律放 SQL 侧**（`expires_at > NOW()`、`due_at < NOW()`），两边同为 UTC 才成立；别在 Node 里 `new Date(row.x)` 再比。
   - **用户输入的墙钟时间**（日期选择器，如请假起止）落库前显式 `-8h` 转 UTC（见 af/leave.js `toUtc()`），存量数据已迁移；展示端统一 `fmtTime()` 还原。
26. **sys_op_log 既放业务审计也放 error.500**：诊断用 `scripts/ops-check.mjs` 按 detail 分组看近 24h；**表里有历史噪音是正常的**（已修 bug 的旧 500 会永久留痕），管理端列表必须 `WHERE action <> 'error.500'` 过滤，判断"是否仍在发生"看 `MAX(created_at)` 距今多久。
27. **★ 移动端适配层（src/mobile.css）铁律**（2026-09-20 建立）：
    - ① 本文件**只允许出现 `@media (max-width: 820px)` 块**，禁止任何全局裸规则 —— 这是"PC 端零回归"的唯一保证（PC 全屏视口下整层样式不命中）；
    - ② 断点值必须与 `src/utils/device.js` 的 `MOBILE_MAX_WIDTH` **同值**：JS 与 CSS 判据必须一致，否则会出现"JS 判定为手机、CSS 判定为桌面"的错位布局；
    - ③ **需要覆盖组件 `<style scoped>` 的规则必须用三倍类名**（`.bld-grid.bld-grid.bld-grid`）：组件 CSS 是**路由懒加载**的，运行时它的 `<link>` 插入在本文件之后，同权重(0,2,0)会被反超 —— 双类名不够；
    - ④ 引入位置：`main.js` 中紧跟 `styles.css` 之后；禁止直接改 `styles.css` 实现移动端效果；
    - ⑤ 移动端专属 DOM 一律用 `v-if="isMobile"`（`useIsMobile()`），保证 PC 视口下这些节点**根本不存在**（实测 PC 下 `.shell-burger`/`.shell-drawer` 数量为 0）。
28. **★ 窄屏横向溢出的两个根因**（按此顺序排查）：
    - ① **grid**：`1fr` 实为 `minmax(auto, 1fr)`，列内内容不可压缩（长数字、不换行文案）时会把列撑宽、进而撑宽整页 → 窄屏改 `minmax(0, 1fr)`；
    - ② **flex column 容器的交叉轴会被内容 min-content 撑开**，而子元素是 stretch 跟随父宽 —— 所以只在 `.shell-main` 上写 `overflow-x: hidden` **无效**，必须在 `.shell-body` 这一层就阻断传导链（实测 library 页 `.shell-main` 被撑到 526px、dashboard 到 726px）；
    - 另：元素**内联固定宽度**（`style="width:260px"`）必须 `!important` 才能覆盖；**宽表格不必强行卡片化** —— `.tt-wrap`、el-table 自身都有横向滚动容器，保留"表内左右滑动"比改写 DOM 更省事；
    - 自检命令：Playwright 取 `document.documentElement.scrollWidth` 与 `window.innerWidth`，两者相等即无溢出。
29. **★ 安全响应头有两处，改一处必须想着另一处**：
    - ① **API 响应头**在 `node-functions/lib/http.js` 的 `SECURITY_HEADERS`；
    - ② **静态资源头**（用户真正访问的 HTML/JS/CSS）在根目录 **`edgeone.json` 的 `headers` 字段** —— 此处 2026-09-21 前**完全为空**，等于"防护全加在看不见的 API 上、真正暴露的页面层裸奔"；
    - **改 CSP 后必须重跑全站回归**：`node .shots/verify-security.mjs`（遍历 21 路由，断言零 CSP 违规 + 零 JS 运行时错误）。CSP 是最容易"修了安全问题、顺手搞坏功能"的头，本地 `npm run build` 通过**不代表**浏览器里没被拦；
    - 缓存策略：`/assets/*` → `public, max-age=31536000, immutable`（Vite 产物带 hash，可长缓存）；`/index.html` → **必须 no-cache**（否则用户拿到旧壳去加载已删除的 chunk）。
30. **前端错误兜底三件套**（2026-09-21 补，此前全都缺）：
    - `main.js` 的 `app.config.errorHandler` + `window.unhandledrejection` —— 只记录不弹窗（业务错误已由 `api/request.js` 统一提示，重复弹窗只会打扰用户）；
    - `router.onError` 处理**懒加载 chunk 失效**：本项目 26 路由中 22 个懒加载 + 部署极频繁，用户停在旧页面再点新路由会请求到**已被替换的旧 chunk** → 404 → 此前直接整页白屏，现自动硬刷新一次（`chunkReloaded` 标志位防刷新循环）；
    - 排查"页面空白"类问题时，先看 console 的 `[vue-error]` / `[unhandled-rejection]`，再看 `sys_op_log` 的 `error.500`。
31. **★★ 移动端表格：绝不能用 `max-width` 压表格**（2026-09-21 修正，血泪教训）：
    - **事故经过**：为消除"页面横向溢出"，曾给 `.el-table` 加 `max-width: 100%` —— Element Plus 会把**所有列按比例压缩**到容器宽度内：账号管理页 11 列被压成一条条按钮堆叠（列宽只剩 42~60px），**完全不可读**。
    - **正确做法**：给 `table.el-table__header` / `table.el-table__body` 设 `width: max-content !important; min-width: 100% !important` —— 表格本体按内容自然宽度，容器不足时由 EP 自带的 `.el-scrollbar__wrap`（`overflow-x: auto`）横向滚动。少列表格**不会**被拉宽，多列表格可左右滑动。
    - **不要去改 `.el-table__header-wrapper` 的 overflow**：EP 默认是 `hidden`，靠 JS 把它与 scrollbar 的滚动位置同步；改成 `visible` 会让表头撑破容器。
    - **根因是测试口径不完整**：当时只断言了 `documentElement.scrollWidth === innerWidth`（无溢出→通过），**没断言"列是否还可读"**。移动端表格验证必须**同时**满足：① 页面无横向溢出 ② 有数据行的表格最宽列 > 80px。命令：`node .shots/audit-tables.mjs`（遍历 13 个页面，无数据行/隐藏 tab 的页面自动降级为只校验溢出）。
    - **通用教训**：**"消除溢出"不能以牺牲可读性为代价** —— 窄屏下宽内容（表格、代码块、大图）的正解是"容器内滚动"，不是"压缩到容器里"。
    - **操作列按钮过多时的处理**（2026-09-21 实施，方案 B）：操作列按钮 ≥3 个的表格（目前仅 `admin/UserManageView`，8 个按钮 / PC 列宽 390px），窄屏把按钮收进「更多」下拉 —— 模板里用 `.op-full` 包住原平铺按钮、另加 `.op-more`（`el-dropdown`，命令分发函数 `onRowMore`）；`.op-more` 在组件 scoped 样式里默认 `display:none`（PC 隐藏），`mobile.css` 窄屏翻转两者，并用 `:has(.op-more)` 把操作列从 390px 收窄到 92px。实测 PC 零变化（仍 8 按钮平铺、列宽 390px）、手机下拉可展开且能触发原操作。
    - ⚠ **操作列只有 1~2 个按钮的表格不要套用**：平铺点击次数更少、也没有横向滚动压力（实测其余操作列宽 90~190px，手机上放得下）。别为了"统一"而过度改造。
32. **★ 改 `flex-direction` 时必须复查 `align-items`**（2026-09-21，两次踩到同类问题的第 2 次）：
    - PC 的 `.shell-body` 是 **row + `align-items: flex-start`** —— 这是**刻意**的（横向布局时让侧栏与内容顶部对齐，不拉伸侧栏）。窄屏改成 `column` 后若不把它改回 `stretch`，子项就会按"**内容自然宽度**"收缩：
      实测 `.shell-main` 只有 **320px** 而容器内容区是 **366px**，表现为"**卡片左右铺不满、右边凭空多出 46px 空白**"（用户反馈"卡片没铺满"）。
    - **同一处还有第二个坑**：`WorkbenchView` 的 `.wb-zoom { zoom: 1.1 }`（PC 刻意放大让内容更饱满）在窄屏会造成**左右不对称**（左 12px / 右 26px）—— 窄屏必须取消缩放（`zoom: 1`）。**`zoom` 属性只在响应式场景下害人，PC 保留无妨。**
    - **排查方法**：遇到"内容没铺满/左右不对称"，先量三层（`.shell-body` → `.shell-main` → 页面根容器）的 `rect.left/width` 与 `align-items`，再查 `zoom`/`transform: scale`。**"不对称"几乎总是指向 `zoom` 或 `align-items`，而不是 padding**（padding 只会造成左右对称的留白）。
33. **★★ Element Plus 按需引入：三类东西模板插件捕获不到**（2026-09-21 实施，配置见 `vite.config.js`）：
    用 `unplugin-vue-components` + `ElementPlusResolver` 按需打包模板里的 `el-*` 组件与其样式，替代原来的 `app.use(ElementPlus)` 全量注册。**但以下三类不在模板里，必须手动处理，漏一个就是线上故障**：
    - ① **函数式 API 的样式**（`ElMessage` 245 处、`ElMessageBox` 33 处 —— 都在 JS 里调用，模板插件看不见）→ `main.js` 显式 `import 'element-plus/es/components/message/style/css'` 及其 message-box；
    - ② **`v-loading` 指令**（25 处）→ 指令不会自动注册，需 `app.use(ElLoading)` + 显式引入 `loading/style/css`；
    - ③ **中文 locale** → 不能再 `app.use(ElementPlus, { locale: zhCn })`，改由 `App.vue` 的 `<el-config-provider :locale="zhCn">` 提供（该组件不产生额外 DOM，不影响布局）。
    - **图标是例外**：菜单/卡片用 `:is="m.icon"`（**字符串**组件名）动态渲染，按需插件解析不了字符串 → `@element-plus/icons-vue` 保持全量注册，但在 `manualChunks` 里单独拆成 `ep-icons` chunk。
    - **`manualChunks` 必须同步改**：原来的 `'element-plus': ['element-plus']` 会把整包塞进同一个 chunk、**直接废掉按需引入**，要删掉，让 EP 组件跟随各自页面自然分包。
    - **验证方法（务必照做）**：① `du -ch dist/assets/el-*.js` 看体积是否真降；② **逐一检查产物 CSS 是否含每个用到的组件样式**（`for c in <组件名>; do grep -lq "\.el-$c" dist/assets/*.css; done`）—— 本次 36 个组件逐一确认无遗漏（`el-option` 无独立类名属正常，其样式挂在 `.el-select-dropdown__item`）；③ 用"**先访问代表页、再查样式表**"的脚本断言 —— **顺序很关键：样式是按需加载的，没访问过的页面查不到对应规则，会误判成"样式缺失"**（本次第一版断言就在工作台查 `el-date-picker`/`el-input`，全都不存在，白报了两个 FAIL）；④ 关键组件 computed style 不能退化（`el-input` 圆角 4px、`el-dialog` 4px + 遮罩）。
34. **★★ 业务模型归属必须先定再动手；文档宣称不得超出实现**（2026-09-21，由「报修两条写入路径」误判引出）：
    - **误判经过**：审计报告曾称"报修有两条写入路径（`/api/af/repair` 建流程实例、`/api/dorm/repair` 不建），模型不一致"。经**全代码 + 全 git 历史**核实**两者皆伪**——`/api/dorm/repair` 从未存在，`/api/af/repair` 也从未建过 `flow_instance`：**报修全项目只有一个写入端点**。误判根源是仓库里留着一个**无路由引用的死文件** `RepairView.vue`（旧 /af/repair 页面，已 301 → /dorm），看起来像"另一个入口"。
    - **教训一 · 文档宣称不得超出实现**：`RESEARCH-功能架构调研.md` 原写"审批流 请假/奖助/报修共用一套流转逻辑"，而引擎**实际只接了请假**。设计期的"预判"若不随实施结果回归，就会变成失实口径，进而在体检/答辩时被当成"缺陷"。**实施完成后必须回头改正预判类文档**。
    - **教训二 · 先定模型归属再动手**：新业务属"审批流"还是"状态机"必须**动手前**判断，判据表见 `DATABASE.md`「审批流 vs 状态机」。**单节点业务**（一个人受理即闭环、语义是"受理/完成"而非"批准/驳回"）**不该套两表流程**——那是无收益的耦合。现状：请假 = 审批流；**报修、社团申请 = 单节点状态机**（有意取舍，非漏接）。
    - **教训三 · 死代码会制造幽灵问题**：改了入口就删旧页面（至少在文档标注"已废弃"）。本次的审计误判与"两条路径"错觉，都源于一个没人访问却仍在仓库里的 `.vue`。
    - **自查命令**：`grep -rn "flow_instance" node-functions --include=*.js | grep INSERT` 看引擎真实接入范围；`grep -rn "<组件名>" src/` 确认无引用后再 `git rm`。
    - **单节点状态机也要有完整终态**：报修原先缺"无法处理"终态（只有 待受理/处理中/已完成），导致师傅发现非本部门职责时**无法正确关闭工单**（只能谎报完成或永远挂着）。已补 `status=3 无法处理`（**必填原因**并通知报修人）——**凡是状态机，先数清终态有几个**。
35. **★★ 测试三层各有分工，一条 `npm run check` 全跑**（2026-09-21 建立）：
    - **① 单测 `tests/unit/*.spec.js`（Vitest，秒级、零外部依赖）** —— 只测**纯逻辑**：时间口径、权限判定（`dataScope`）、时段冲突、性别约束、HTTP 层结构。**刻意不测组件**（不引 jsdom），需要真实页面时走 e2e。
    - **② 库体检 `scripts/{sql-smoke-m4,integrity-check,gap-check}.mjs`（只读）** —— 对真实 TiDB 验证 SQL 字段名与数据一致性。**新 API 上线前必跑**（防 `ER_BAD_FIELD_ERROR` 与静默数据不一致）。
    - **③ 线上 e2e `scripts/e2e-smoke.mjs`（只读 GET、可重复跑）** —— 四角色 + 越权边界 + 历史缺陷回归。**新增/修改端点后必须补一条断言**。
      - ⚠ 对 EdgeOne 的一种**已知偶发**（POST body 被平台重复读取 → `50000 Body is unusable: Body has already been read`，**部署窗口期更易撞上**）在 `postJson` 里做**一次重试**：**只认这一种错误消息**，其它 500 一律照常判失败 —— 否则会把真实缺陷掩盖成"抖动"。排查这类问题时先跑 `node scripts/ops-check.mjs` 看 `sys_op_log` 的 `error.500` 分组拿到真实错误消息（本次即靠它一条命令定位到是平台问题而非代码问题）。
      - 服务端配套：读体后**先把缺失键归一化**（`String(body.x || '')`）再校验，可显著降低该偶发触发率。
    - **加测试的三条规矩**：① 改核心规则先问"这条规则能被单测吗"，不能就把纯逻辑抽成函数（本次 `lib/schedule.js` / `lib/dorm-rules.js` 即这样产出——它们原先内联在事务闭包里，**任何测试都覆盖不到**）；② 写"重构等价性"断言后**必须验证它能失败**（本次用 `Number(null)===0` 反例验证；没验证过的断言可能只是"永远绿"的摆设）；③ 优先只读断言（可随时重跑、不污染演示数据）。
    - **⚠ ESLint 规则强度刻意克制**：只开**错误级**规则（`js recommended` + `vue flat/essential`），**绝不加格式类规则** —— 一旦引入必然产生几百条历史噪音，最终结果是"没人再看 lint"。`ignores` 里排除 `scripts/`、`.shots/`（一次性脚本不强求风格）。
36. **★★ AI 能力只用文本，禁碰多模态（开发测试期成本红线，2026-10-09 用户指定）**：
    - **原因**：qwen3.8-omni-flash 是 omni（多模态）模型，但**图片 / 音频 / 视频的计费远高于纯文本**。项目处于开发测试期，成本敏感，任何多模态调用都是白烧额度。
    - **禁止**：请求体传 `image_url` / 音频 / 视频；做 OCR、图片理解、语音识别与合成、图像/视频生成；**因为"模型支持多模态"就去试多模态接口**。
    - **连带**：ADR-9 原「论坛 AI 审核（图片走视觉能力）」**降级为纯文本审核**；需要图片审核须另立 ADR 并先定预算。
    - **配套**：AI 调用默认 **`enable_thinking: false`**（意图 JSON 快 6.2 倍、输出 token 降 94%，且关思考才解锁 `tool_choice: required`）；每次调用设 `max_tokens` 上限；RAG 走检索 TopK，禁止整篇长文档塞上下文。
    - 违反表现：账单出现 image/audio 类计费项；`working/` 或 `scripts/` 里出现多模态试调脚本。
37. **★★ Node Functions 的每个 handler 必须 `try/catch` + `jsonError(e)` 兜底（2026-10-09 线上实测确认）**：
    - **机制**：EdgeOne 对"未捕获异常"不返回 500 JSON，而是换成 **502 HTML 崩溃页**（`FUNCTION_INVOCATION_FAILED`，文案 "This function has crashed"，页面里还会把异常 message 原文显示出来）。因此 **`HttpError`（40103/40301）如果没被 catch，也会变成 502 HTML**。
    - **后果（2026-10-09 真实故障）**：新写的 3 个 `/api/ai/*` handler 漏了包装（全站 41/44 个 handler 都有，就这 3 个没有）→ ① 令牌过期时 `/api/ai/chat` 返回 502 HTML，前端判不出 SSE 也 `res.json()` 失败，只显示默认兜底文案「智能问答暂时不可用」——**看起来像 AI 服务坏了，实际是鉴权异常穿了**；② 因为状态码是 **502 而不是 401**，前端的"401 自动续期"分支根本没进，用户被硬生生卡住；③ 线上无控制台，异常没落 `sys_op_log`，无法远程定位。
    - **规范**：handler 体一律 `try { ... } catch (e) { return jsonError(e); }`；`jsonError` 会把 `HttpError` 按其自带 status/code 返回，其余落 `sys_op_log(action='error.500')`。**流式（SSE）接口同样要包**——包住"开始生成之前"的部分即可（响应头一旦发出就无法再改 JSON）。
    - **自检**：`for f in $(find node-functions/api -name "*.js"); do grep -q jsonError "$f" || echo "缺: $f"; done` 必须无输出。
    - 违反表现：线上出现 `502 FUNCTION_INVOCATION_FAILED` 的 EdgeOne HTML 错误页；前端收到 HTML 却按 JSON 解析。
38. **★ 边缘平台会偶发消费请求体（`Body is unusable: Body has already been read`）—— 按可重试错误处理，别当自己的 bug（2026-10-09 查明）**：
    - **现象**：`readBody` 里 `request.text()` 抛 `Body is unusable: Body has already been read`，穿透成 50000「服务器内部错误」。
    - **实测结论**：查 `sys_op_log` 发现这是**平台长期行为**，自 **2026-09-17（项目第 2 天）**起累计 **37 次**，且**与业务耗时无关**（一次不含任何 AI 调用、毫秒级返回的请求也会中），密集连打时概率约 15%。**不是超时重试导致的**（曾据此推断过，被数据推翻）。
    - **处理**：`lib/http.js` 的 `readBody` 单独捕获 → `code=49406` / `HTTP 503` + 落 `sys_op_log(action='error.bodyUnreadable')`；前端 `api/request.js` 对非 GET 的 5xx **本就有自动重试一次**的逻辑 → 用户无感恢复。**不要**改回 500（会误导为"系统坏了"且无法统计）。
    - **排查提示**：遇到"看起来毫无道理的 500"，先查 `sys_op_log`：`SELECT action, target, detail FROM sys_op_log WHERE action LIKE 'error.%' ORDER BY id DESC LIMIT 20`。历史上这里还躺过 `Unknown column 'r.activity_time'`（7 次）、`Cannot read properties of undefined (reading 'n')`（5 次）等真 bug。
39. **★ 精确查找一律走 SQL 条件，不要"分页查询 + 内存过滤"（2026-10-09 踩实）**：
    - 实例：C5 目标解析原实现是 `findUsers(limit 200)` 后按名字内存筛；而库有 500+ 账号、按 id 升序分页 → **新建账号永远落在最后一页之外**，表现为「禁用账号 xxx」预览恒为空。
    - 规律：这类 bug **只在数据量超过一页、且目标恰好在后面时暴露**，用老数据测像是好的。凡"按标识精确查"（账号名/学号/单号）一律写成 SQL `IN` 条件。
40. **★ mysql2 会把 `DATETIME` 返回成 **Date 对象**，不是字符串（2026-10-09 踩实，后果是"结论反了"）**：
    - 现象：`String(row.start_at)` 得到 `"Fri Sep 18 2026 08:00:00 GMT+0800 (中国标准时间)"`，再拼 `'Z'` → Invalid Date。而解析失败的代码路径**静默返回空数组**，于是"请假期间有课冲突"被算成"没有课"——**把"系统算不出来"伪装成"学生没课"**。
    - 规范：**涉及 DATETIME 做计算时，SQL 侧一律 `DATE_FORMAT(x, '%Y-%m-%d %H:%i:%s') AS x` 取成字符串**（与"库内 UTC 墙钟"口径一致，铁律 #25），并在函数入口做**严格类型校验**（非字符串 → 返回 null / 抛错），**不要**用 `String(v)` 兜底。
    - 通用教训：**"解析失败"绝不能等价于"没有"**。凡是"根据解析结果决定分支"的地方，都要有"无法判断"这个第三态，并把它如实告诉用户/模型。
41. **★ 让模型"基于事实说话"，并在事实里写明数据缺失（2026-10-09 验证有效）**：
    - C4 审批助手的做法：服务端先算好事实（近 30 天请假次数/天数、时段内有课的课程清单），再让模型只做"基于事实的表述"，**不让模型自己去猜风险点**。
    - 收益已被验证：事实里出现 `NaN` 与"没有课"的自相矛盾时，**模型主动在风险点里指出了这个矛盾**（"请假时长显示为'约 NaN 天'，系统计算异常"），我们据此才发现了上面那个 bug——纯生成式做法只会顺着错数据继续编。
    - 落地要求：事实文本里凡"取不到/算不出"的项，都要显式写成「⚠ 该数据无法获取」并说明影响，**不要留空、不要给默认值**。
44. **★ Vue 3 里 `ref([...])` push 进去的对象，必须从数组取回 reactive 代理再改（2026-10-09 线上踩实）**：
    - 症状：流式回答「文字憋到最后一刻一次性出现」+「输出完后光标一直闪几十秒」。**后端与 SSE 协议都正常**（实测 `done` 事件到流关闭只差 1ms），纯前端渲染问题。
    - 错误写法：
      ```js
      const reply = newReplyMessage();   // ← 原始对象
      msgs.value.push(reply);            // 存入数组
      reply.content = 'x';               // ★ 改原始对象：不触发任何渲染
      ```
      `msgs` 是 `ref([])`，push 的原始对象会被数组代理包装，**模板拿到的是 reactive 代理**，而 `reply` 仍指向原始对象 —— 两者不是同一个东西。
    - 正确写法：
      ```js
      msgs.value.push(newReplyMessage());
      const reply = msgs.value[msgs.value.length - 1];  // ★ 取回代理
      ```
    - 通用判据：**凡是把对象放进响应式容器，之后要持续改它的字段，就必须用容器里取回来的那个引用**。改完如果"数据明明变了但界面不动"，第一个怀疑对象就是它。
    - 衍生的坑：光标这类"由布尔值控制显隐"的元素，一旦该布尔值写在非代理对象上就会**永久留在 DOM**（CSS 动画照跑，看起来像还在加载）。所以凡控制显隐的状态，务必额外加一个与流无关的**兜底收尾**（本项目用 `WATCHDOG_MS=90s` 看门狗 + 发送结束时的 200ms 保险）。
45. **★ 这台机器上 `git push` 报 `terminal prompts disabled` 的真因是凭据助手路径含空格（2026-10-09 查明）**：
    - **别误判**：不是凭据失效、不是网络问题、也不是权限问题。用户在自己终端里能正常 push。
    - **真因**：`credential.helper` 指向 `C:/Program Files/WorkBuddy/.../git-credential-manager.exe`，Git 通过 `sh -c` 调用外部 helper 时会在空格处截断成 `C:/Program`（报 `No such file or directory`）→ 拿不到凭据 → 退回终端提示 → 被非交互环境禁用 → `fatal: could not read Username`。
    - **已修**（仓库级 `.git/config`，不污染全局）：
      ```bash
      git config --local --unset-all credential.helper
      git config --local --add credential.helper "C:/Users/Administrator/.workbuddy/binaries/PortableGit/versions/1.2.0/mingw64/bin/git-credential-manager.exe"
      ```
    - **诊断顺序**（照着走，别跳步）：① `git ls-remote` 验网络（不需要凭据）② `printf 'protocol=https\nhost=github.com\n\n' | git-credential-manager.exe get` 验凭据（值不要打印到日志）③ `GIT_TRACE=1 git push --dry-run` 抓真实报错。
    - **两个坑**：单独把 exe 复制到别处会抛 `FileNotFoundException: 找不到程序集 gcmcore`（依赖同目录程序集）；配置里已有多条 helper 时必须先 `--unset-all` 再 `--add`，否则报 `cannot overwrite multiple values`。
    - **非交互环境**跑 git/脚本一律加 `GIT_TERMINAL_PROMPT=0`，任何回落到交互提示的路径都会挂起。
46. **★ 权限/范围判断必须「默认拒绝」，漏一个分支就是越权（2026-10-10 踩实）**：
    - 实例：`lib/ai-query.js` 的 `scopeWhere`，辅导员分支只写了 `af_leave` 与 `edu_elect`
      的本院条件，**其余实体落到 `return { sql: '' }`** —— 也就是"不加任何限制 = 全校可见"。
      本地实测「辅导员查账号数」返回 **490（全校）**，应为 58（本院）。
    - 修复：改成白名单式。明确支持的实体给本院条件；**未登记的实体退化为"只看本人"（最保守），
      绝不退化为"不加限制"**。
    - **★ 同一天在 4 处旧代码里又发现同一个坑**（说明这不是某一处的疏忽，而是**一种写法习惯**）：
      `dataScope()` 在「角色不在 admin/leader/counselor 里」或「辅导员 `deptId` 为空」时
      返回 `{type:'self'}`，而 `lib/services/leave.js`、`lib/services/users.js`（`buildWhere` +
      `findUsersByNames` 两处）、`lib/ai-approval.js` 的写法都是
      `if (scope.type === 'dept') { ...加本院条件... }` —— **没有 else 分支**。
      本地直连实测：教师账号能拿到**全校 100 条请假单**、**490 个账号**（均应为 1）。
      更隐蔽的是 `api/af/leave.js` 的 GET：**连角色门槛都没有**，而文件头注释写着
      "学生=本人 / counselor·admin·leader=本院或全校" —— **注释与实现不符**，
      读代码的人会以为已经拦住了。修复后实测：教师 请假 0 条 / 账号 1 个。
    - **推论**：凡 `dataScope()` 的返回值，**必须穷举 `all` / `dept` / `self` 三种类型**；
      写成 `else if (scope.type !== 'all')` 的兜底写法最稳（未知类型也一并按最保守处理）。
      改任何一处时，**顺手 grep 全项目的 `dataScope` 用法**，别只改眼前这一处。
    - 通用写法：写 `if (allowed(x)) return ...;` 之后，**末尾必须有一条兜底**，
      且兜底要与"拒绝"语义一致 —— 越权方向上永远不能有 fall-through。
    - 配套测试：单测里必须有"用无权角色/缺参数的用户去查，断言拿到的是范围限制条件而非全集"。
      （本项目：`tests/unit/ai-hardening.spec.js` 里断言「教师 = 1 个账号 / 0 条请假，
      管理员仍看全校」—— 后半条同样重要，兜底不能把正常角色一起挡掉。）
47. **★ 给模型看的字段目录只给「语义层」，绝不给 SQL 片段（2026-10-10 设计决定）**：
    - 原因：模型一旦看到列名与表达式，它就会开始写 SQL 式的东西（自定义别名、拼函数、
      要求 JOIN），白名单随即失效。
    - 做法：注册表里的 `sql` 片段**只存在于服务端**；给模型的只有
      `{对象, 字段key, 中文label, 类型, 枚举可选值, 能否分组, hint}`。
    - 同一份渲染逻辑被两个端点复用（`entityPromptSections`）：两份提示词必然漂移，
      改注册表说明时只改一处才对。
48. **★ 最危险的不是报错，是「静默错误」——把"没算出来"当成"没问题"，或给出与数据相反的结论（2026-10-10 体检踩实）**：
    - 本类缺陷的共同特征：**不抛异常、不崩溃、日志干净**，只是给出一个看起来正常但错误的结论。
      用户会照着它做判断，比显式失败危害大得多。体检中一次抓到 4 处：
      1. `ai-triage` 降级（AI 没回结果）时仍拼出 `[普通] → 后勤处` 这种**像真实分诊**的文本写进工单备注；
      2. `ai-eval` 把"AI 能力未开启 / 调用失败"记成 `ok:false` → **污染准确率分母与误报率分子**
         （把上游抖动算成"模型判断错"，指标直接失真）；
      3. `ai-anomaly` 用 `String(new Date()).slice(0,10)` 取日期 → 得到 `Thu Oct 01`（铁律 #40 的老场景）；
      4. `ai-summary` 把"内容太短不需要摘要"与"AI 调用失败"**都返回 null**，调用方无法区分。
    - **规范**：写"降级/失败/无数据"分支时，问自己三个问题 ——
      ① 这个返回值与"算出来是 0 / 确实没有"**可区分**吗？② 它会不会被当成真实结论写进库或展示给用户？
      ③ 评估/统计口径会不会把它算进去？三者任一为"否"，就必须显式标注（本项目用 `degraded` 标记 + `skipped` 状态）。
    - **判据**：**"数据明明变了但界面不动""问最差却答最高""指标突然反常"——先怀疑静默错误，而不是先怀疑模型。**
49. **★ AI 总开关必须在「唯一出口」守，不要逐个模块加（2026-10-10 体检发现总开关形同虚设）**：
    - 现象：9 个会调 AI 的模块里**只有 1 个**检查了 `ai.enabled`。管理员在控制台关掉"AI 总开关"后，
      论坛审核 / 公告摘要 / 报修分诊 / 失物匹配 / 审批助手 / 图书检索**仍然照调不误** ——
      与"总开关"这三个字的承诺不符（且继续烧额度）。
    - 修法：在**全项目唯一 AI 调用出口** `lib/ai.js` 的两个入口（`aiUpstream` / `aiChat`）统一守卫。
      **一处生效、全覆盖，且以后新增能力自动受控** —— 逐个模块加必然漏，实测已经漏了 8 个。
    - 配套：关闭时**不要落 `ai.error` 日志**。那不是"失败"而是管理员主动关闭；若记成错误，
      关闭期间会持续写日志，还可能凑满"10 分钟 5 次"的阈值**给管理员发一封"AI 失败"告警邮件** —— 自扰。
50. **★ 用 DB 流水计数的限流有 check-then-act 窗口；内存补充要带 TTL 自愈（2026-10-10 体检发现）**：
    - 问题：频控的计数读 `ai_usage_log`，而那一行是在 AI 调用**结束后**才写入的。
      「读计数 → 调 AI → 写流水」之间存在**与调用时长等长**的窗口 ——
      同一秒内并发的 N 个请求会全部读到旧计数而同时放行（TOCTOU）。
    - 修法：放行时在**本实例**登记一条"在途"标记并计入配额，调用结束后释放。
      **★ 释放不是必须成功的**：标记必须带 TTL 自动失效 —— 内存计数器最危险的失败模式是
      "某条路径忘了释放 → 用户被**永久锁死**"。有 TTL，最坏只是多限制一会儿。
    - **诚实标注局限**：EdgeOne 是多实例的，内存 Map 只覆盖当前实例，跨实例并发仍可能略超限额。
      "每分钟 N 次"是**成本控制**而非安全边界 —— 不要把这种补丁说成"已彻底解决"。
    - 与铁律 #23 的关系：#23 否定的是"**用内存计数当限流本身**"，这里只是给 DB 计数打窗口补丁，**两层并存**。
51. **★ 改了数据字段，必须同步改「决定走哪个渲染分支」的那个字段（2026-10-10 用户实测"没有任何输出"）**：
    - 现象：管理员问「查看当前学生数量」，界面显示 **「查询账号 / 查询完成」，一个数字都没有**。
    - 根因：前端 `kind` 决定模板走哪一支，而 `read` / `data` 分支渲染的是
      「label + summary + 表格」，**完全不渲染 `content`**。
      服务端给了单值（`scalar`），前端也把答案写进了 `reply.content` —— **但没把 `kind` 从
      `'read'` 改成 `'text'`**，于是走的是查询表分支：label 有值、summary 没赋值（兜底成"查询完成"）、
      rows 为空 → 答案明明算出来了，界面却只显示"查询完成"。
    - 三个分支（action-read / action-data / insight）**当时只改了后两个**，漏掉的那个就出了这个 bug。
    - 修法（两层）：
      ① **单一收口**：在所有分支之前统一判断「有 `scalar` 且 kind 是 read/data → `kind='text'`」，
         不要让每个分支各记得改一次（必漏）。
      ② **模板兜底**：`v-else-if` 上加条件 `(m.label || m.summary || m.rows.length)` ——
         该分支若**没有任何可渲染内容**，自动落到渲染 `content` 的 `v-else`。
         这样"忘记降级 kind"这类疏漏**在机制上不再有后果**。
    - 判据：**界面显示"完成/成功"但没有任何数据 → 先查"决定渲染分支的字段"与"承载数据的字段"是否同步。**
52. **★ `COUNT(*)` 旁边有 `LEFT JOIN` 时，先问"这个 JOIN 参与筛选吗"（2026-10-10 实测多算 1）**：
    - 现象：AI 答"学生有多少"返回 **404**，数据库里明明是 **403**。
    - 根因：`countUsers` 的 `FROM sys_user u LEFT JOIN sys_user_role ... LEFT JOIN sys_role ...`
      **不参与筛选**（角色筛选是在 `buildWhere` 里用 `EXISTS` 子查询做的），
      但它会**按"用户拥有的角色数"放大行数** —— `admin` 同时有 `admin` + `student` 两个角色，
      于是每次匹配到它都多一行，正好多 1。
    - 修法：`COUNT(DISTINCT u.id)`。（同一文件里 `findUsers` 用同一套 JOIN 但配了 `GROUP BY u.id`，
      所以它没这个问题 —— **同样的 JOIN，一个去了重、一个没去重，就会只在一边出错**。）
    - 通用判据：写聚合时先看 JOIN 是"筛选用的"还是"取字段用的"；
      **凡是会放大行数的 JOIN 与 `COUNT(*)` 同现，一律先想 `COUNT(DISTINCT 主键)`。**
    - 配套：计数类函数必须有"与库里 `COUNT(DISTINCT)` 对账"的单测，
      并**特意覆盖多角色账号**（本项目 `admin` 就是天然的多角色样本）。
53. **★ 用了模板/规则回答时，摘要必须覆盖用户问的那个维度（2026-10-10 用户实测"答非所问"）**：
    - 现象：问「查看当前学生数量」，`user_stats` 模板回的是
      「全校共 490 个账号；拥有管理员角色的 1 人。」—— **一句没提学生**。
    - 根因：模板的 summary 是**写死的**（只报总数 + 管理员数），它不知道用户问的是哪个角色；
      数据其实在 rows 里（学生 403），但**标题句答非所问**，用户第一眼看到的就是错的那句。
    - 修法：让摘要**逐维度罗列**：「全校共 490 个账号：学生 403 人、教师 40 人、校领导 39 人、
      辅导员 8 人、管理员 1 人。」—— 无论用户问哪个角色，答案都在句子里，
      **不依赖模板去猜意图**（猜意图要么加参数、要么调模型，都比罗列更脆）。
    - 判据：**模板/规则类回答的摘要里，不能只出现"总数"这类与问题维度无关的量。**
54. **★ `scalar` 只能由「结果是单个值」的分支设置，列表分支绝不能给（2026-10-10 实测：清单被吞）**：
    - 现象：用户说「查看所有禁用的账号」（**要清单**），界面却只回一句「共找到 2 个账号」，
      **想看的表格没了**。
    - 根因：`query_users` 的**列表分支**也返回了 `scalar`（曾写 `rows.length < 50 ? rows.length : null`）。
      而 `scalar` 的契约是"结果是一个单值、不是一张表"，前端据此**只答一句话、不渲染表格**。
      → 本来是为了让"问数量"少显示一张 1 行的表，结果把"要看清单"的场景也一起压成一句话。
    - 修法（两层）：
      ① **服务端**：只有 `countOnly`（问数量）分支才给 `scalar`，列表分支一律不给。
      ② **前端防线**：`scalar` 只在**没有多行清单**时才降级为纯文本
         （`rows.length <= 1`）—— 万一将来服务端又在清单上误带 `scalar`，**清单永远优先**。
    - 通用判据：**凡是"给前端用来决定怎么渲染"的字段（`kind` / `scalar` / `mode`…），
      都必须有唯一、明确的语义，并且要在最坏情况下也不丢数据。**
      加这类字段时先问：*如果它标错了，用户会看到什么？* ——
      能容忍的是"多显示一张表"，不能容忍的是"该显示的没显示"。
55. **★★ 单测层按设计「不连库」，所以别把"必须连库"的断言写进 `tests/`（2026-10-10 查实：一批测试一直是假通过）**：
    - `vitest.config.js` 顶部写得很清楚：单测层**不加载插件、不依赖 jsdom，也不连库** ——
      "这样单测保持秒级、无环境依赖，才能进 pre-commit 与 `npm run check`"。
    - 我却往里加了一批"查真实数据才成立"的断言（计数口径、数据范围、列表/单值语义…），
      并统一用 `try { … } catch { expect(true).toBe(true); return; }` 兜住。
      **在 vitest 下（无 DB）它们永远走 catch 分支** ——
      报告里显示"✓ 通过"，实际**一条断言都没执行过 = 假通过**。
      实测证据：同一段代码在 vitest 里连 `SELECT 1` 都失败（`EACCES AggregateError`），
      而 `npx vitest run` 的通过数却一直是绿的。
    - **修法（两层）**：
      ① 那些 describe 全部改成 `describe.skipIf(!process.env.DB_HOST)(…)` ——
         **显式跳过**，报告里如实显示"skipped"，不再冒充通过。
      ② 真实验证迁到 **`scripts/ai-check.mjs`**（照 `integrity-check.mjs` 的既有模式：
         自己读 `.env`、直连真实库、**连不上就 `process.exit(1)` 大声失败**），
         并接进 `npm run check`（`check:ai`）。
    - **判据**：**"报告显示通过"必须等于"断言真的执行过"。**
      写完测试先问：*这条断言在无库/无网环境下会走哪条路？*
      如果答案是"catch 里假装通过"，那它就是个安慰剂 ——
      **要么显式 skip，要么挪到会连环境的检查脚本里。**
      同理适用于任何"靠 catch 兜住当跳过"的写法。
56. **★ 内部能力代号（C1~C13）不要出现在面向用户的界面上（2026-10-10 用户反馈）**：
    - 现象：AI 管理控制台「功能开关」的 20 条标签写成 `C1 校园智能问答`、`C6/C13 信息问数与自由统计`，
      用户直接问"这种 C 开头的编号是干啥的"。已全部去掉，界面只留功能名。
    - 代号是**文档与论文内部的对照体系**（`docs/AI-FEATURES.md` 用它给能力编号），
      对使用者没有任何意义 —— 用户既不知道 `C1` 是什么，也看不出 `C6/C13` 为什么合并成一个开关。
    - 做法：**界面只显示功能名**；代号保留在**文档与代码注释**里
      （论文要引用，改代码的人也要能与文档对上号），注释用户看不到，两边不冲突。
    - 通用判据：**凡是"只有内部人看得懂、用户看不懂"的编号/缩写，都不要上界面。**
      同类还有：数据库表名与字段名、错误码（`49402`）、任务编号、内部版本号。
    - 落地检查：改完 grep 一遍 `label:` 与模板文案，**把注释过滤掉再搜一次代号** ——
      `<!-- … -->`、`//`、`/* … */` 里保留是对的，模板文本里出现才是问题（用注释标记过滤即可区分）。
57. **★★「学期」是业务语义，不只是一个字段 —— 动选课/成绩数据前先确认它属于哪个学期（2026-10-10 事故）**：
    - 现象：用户反馈「选课了 前端不显示选课 但是数据库确实有 **以前不会的**」。
      实测：教学班 `enrolled` 合计 2012，而 `edu_elect` 里 `status=1`（在选）**只剩 1 条**、
      `status=2`（已出成绩）有 **2015 条**；逐班对照 `enrolled=60` 的班，"在选" 0 条、"已出成绩" 60 条。
      后果：选课页判断「我是否选了这门课」用的是 `edu_elect.status = 1`
      （`api/edu/course.js` 的 `mine` 子查询），于是**所有课都显示"选课"** ——
      学生既看不到自己选了什么，也退不了课（drop 要求 status=1）。
    - 根因：**是我自己造的演示数据造成的**。`seed-demo-data.mjs` 原先给**当前学期**的
      选课记录直接写分数、并把 `status` 改成 2，把「当前学期在选」与「往年学期已出成绩」
      **压进了同一批记录**。`status` 的语义是"**该学期内**的状态"，不是全表状态。
    - 规则（今后动这类数据必须遵守）：
      ① 当前学期：只允许 `status=1`（在选）+ `score IS NULL`；
      ② 成绩：挂**历史学期** + **独立的教学班** ——
         `edu_elect` 的唯一键是 `(class_id, student_id)`（**不含 term**），
         所以历史成绩不能复用当前学期的教学班，否则会把两学期挤进同一行；
      ③ 历史教学班 `edu_class.status = 0`，绝不能出现在选课目录里。
    - **沉淀成硬断言**：`scripts/integrity-check.mjs` 新增两条**学期语义不变量**，
      不通过时以**非零退出码失败**（其余检查仍是"只报告"），这样 `npm run check` 拦得住：
      - 当前学期非「在选」的选课记录数 = 0
      - 教学班 `enrolled` 与该班在选记录数一致（`enrolled` 就是"已选人数"，两者必须相等）
      修复入口：`node scripts/seed-demo-data.mjs --fix-elect`（显式参数，不做默认行为 ——
      将来真录入了本学期成绩后，重跑 seed 不该把它清掉）。
    - 通用判据：**状态字段（`status`/`state`）往往是"某个维度内的状态"**（这条记录在这个学期什么状态）。
      造数据前先问一句"这条记录属于哪个维度"，别把所有记录塞进同一个状态值。
42. **★ 推送前必须跑 `npm run check:import`（部署前导入自检，2026-10-09 踩实）**：
    - **现象**：P8 推送后新端点迟迟不生效、一直回落到 SPA，**从外部看不到任何报错**。
    - **根因**：`api/ai/anomaly.js` 写了 `import { clientIp } from '../../lib/guard.js'`，而该导出实际在 `lib/http.js`。**导入一个不存在的导出会让 EdgeOne 构建失败**，而 EdgeOne Pages 只在**构建日志**里提示 → 外部表现只是"部署没生效"，极易误判为"平台慢"或"业务逻辑错"。
    - **对策**：`scripts/import-check.mjs`（已并入 `npm run check`）把所有 `node-functions/**`、`edge-functions/**` 逐个 `dynamic import`，导入/路径问题**本地 1 秒暴露**。当前 91 个模块、失败 0。
    - **判据**：**线上"部署不生效"时，第一个要怀疑的是构建失败，而不是平台慢。** 先本地自检，再去 EdgeOne 构建日志。
43. **★ "错误率高"要先看错误来源分布，别急着换基础设施（2026-10-09 用数据纠正）**：
    - 曾怀疑 TiDB 免费版扛不住。实测：**数据库/连接层 0 次失败**（140 次连续查询 0 失败）；近 22 天 57 次 500 中 **65% 是 EdgeOne 平台消费请求体、18% 是 JS bug、12% 是 SQL 写错、0% 是数据库**。
    - 结论：**换付费数据库解决不了这里的问题**。完整实测数据见 **`docs/PERFORMANCE.md`**（延迟分位、错误归因、AI 语义层成功率、容量评估、优化优先级）。
    - 规范：遇到"错误率高"的论断，先跑归因（`sys_op_log` 的 `error.*` 分类 + `ai_usage_log` 成功率），再谈选型。**不要用基础设施替换来掩盖自己代码里的 bug。**

## 6. 交付与验证流程

0. **开工前/交付前盘点**：`node scripts/gap-check.mjs`（只读）——规模、角色分布、封面/blob/令牌剩余项实测、演示账号残留、线上错误最后发生时间，对照 docs/PROGRESS.md 阶段 5 确认差距
1. 改代码 → **`npm run check`**（lint → 单测 → 导入自检 → 库体检 → AI 层检查 → 线上 e2e → README 自检，一条命令七段；分层职责见铁律 #35）→ `npm run build`（前端构建必须过）
2. **提交用显式 add，禁止 `git add -A`**：`git add <改动的具体文件>` → commit → push（凭据在 Windows 凭据管理器；`git -c credential.helper= push <user:pass 编码后的 url> main`）。曾因 `git add -A` 把 `working/` 调试产物带进仓库（b4dc948 才清出）
3. 等约 2.5~3 分钟部署（部署未完成时新旧函数混跑会出"诡异 500"，先等满再测）→ 线上验证
4. **线上验证优先用固化脚本**：`npm run check:e2e`（即 `scripts/e2e-smoke.mjs`，56 项只读断言（2026-10-07 实测合计数，含 M4 增补），覆盖四角色 + 越权边界 + 历史缺陷回归，可反复重跑不污染数据）。**只有固化脚本覆盖不到的场景**（如新增业务链路的写操作）才写一次性 Node 22 脚本（原生 fetch 打线上全链路，跑完即删），并同步把可长期复用的断言补进 `e2e-smoke.mjs`。脚本执行时注意：**Bash 工具的 cwd 不随 `cd` 持久**，每条命令都要自带 `cd /c/Users/Administrator/Desktop/zhihui-campus && ...`
5. 收尾必须同步 docs（见 CONVENTIONS.md 会话纪律）
   - **★ 脚本执行纪律（2026-10-09 踩实，用户明确要求"不要再出现"）**：临时 Node 脚本**结尾必须 `process.exit(0)`**。连过 TiDB（mysql2）的脚本即使 `await conn.end()`，连接池仍持有 handle 让事件循环不空 → 命令"跑完了却不结束" → 超时被杀 → 若输出接了 `tail`/`head`/重定向（非 tty，Node 用 64KB 块缓冲）**缓冲区全丢、一个字看不到**，看上去像卡死。判据：**长时间无返回 + 零输出 → 先怀疑"进程未退出 + 输出被缓冲"，而不是"任务太重"**。对策：脚本显式退出；看输出先 `> 文件` 再 `cat`，别接管道；耗时命令（build/安装/e2e/等部署）放后台收通知。另：`npm run build` 前先把 `dist` 改名移走，否则 Vite 的 `emptyDir` 会撞环境删除钩子超时（`[safe-delete] … ETIMEDOUT`）。`scripts/seed-ai-kb.mjs` 已按此规范补上 `process.exit(0)`。
6. **README 与配图维护**（项目对外门面，界面/功能有变动后同步）：
   - **重截截图**：`npm run shots`（=`scripts/make-readme-shots.mjs`，打线上真实环境，输出 `docs/images/`，JPEG q86 控体积）。可切环境：`SHOT_BASE=http://127.0.0.1:4178 npm run shots`
   - **⚠ 数据驾驶舱截图需 admin/leader 权限**：`admin` 密码已于 2026-09-22 经自助改密功能被用户修改，需以 `E2E_ADMIN_PWD=<密码> npm run shots` 提供；**未提供时脚本跳过该图并保留已有文件**（不用旧图/坏图覆盖）
   - **完整性自检**：`npm run check:docs`（=`scripts/check-readme.mjs`）—— 校验 19 处图片与 10 处文档链接是否存在、扫描过时表述（如已砍掉的 `miniprogram/`）、统计图片总体积。**已串入 `npm run check` 成为第五段**
   - **⚠ gitignore 覆盖坑**：`!scripts/check-readme.mjs` 这条白名单**必须写在 `check-*.mjs` 规则之后**（后匹配规则优先），写在前面会被忽略（实测踩过）
   - 架构配图复用论文自绘 SVG 导出的 PNG（`.shots/paper/fig-0*.png`），放入 `docs/images/` 前**需裁掉底部论文题注**

## 7. 当前完成度

| 模块 | 状态 |
|---|---|
| 统一认证（双令牌/轮换/重放检测/锁定/审计） | ✅ 上线 |
| 五角色 RBAC + 组织架构（院系/班级）+ 用户管理 | ✅ 上线 |
| M1 教务：选课（防超卖+时段冲突）/课表（固定网格导出打印）/成绩单/教师录入 + 课程排课管理 | ✅ 上线 |
| M2 学工：请销假审批流闭环/报修工单/公告 | ✅ 上线 |
| 门户：SSO 联动 + 工作台 + 校园邮箱卡 + 资源链接 | ✅ 上线 |
| **校园邮箱**：注册验证码/管理员开通收发//mail 收发件页/已发送/多域名 | ✅ 上线（生产全链路验证） |
| **M3 生活服务**：图书借阅/失物招领/社团活动/校园论坛（含交易板块）/忘记密码 | ✅ 上线（schema-009，2026-09-20） |
| 演示数据（402 学生/40 教师/8 辅导员/10 校领导 + 29 行政人员） | ✅ 已入生产库 |
| 安全审计（docs/AUDIT-2026-09-17.md） | ✅ 1P1+3P2 已修复 |
| **M4 校领导驾驶舱**：全校聚合只读大屏 | ✅ 上线（/dashboard，admin+leader） |
| **M4 宿舍管理**：楼栋房间/性别约束分配/我的宿舍/报修并入 | ✅ 上线（schema-010，/dorm） |
| **M4 站内信**：消息中心/铃铛未读/审批自动通知 | ✅ 上线（schema-011，/messages） |
| 限流（登录/发码 DB 流水计数）| ✅ 上线（内存版多实例失效，已改 DB） |
| Edge 原生轻端点 /api/edge/stats（KV 访问统计） | ✅ 上线 |
| **AI 融合**（C1~C13 共 13 项能力） | ✅ **2026-10-10 全部上线** —— `lib/ai.js` 统一出口 / 对话式系统管理 / 论坛 AI 审核 / 信息问数与自由统计 / 学业助手 / 报修分诊 / 公告摘要 / 失物匹配 / 异常监测 / 图书检索 / 审批助手 / 管理控制台。模型 **qwen3.8-omni-flash**（阿里云 DashScope 兼容网关·实测上下文 40 万字·`reasoning_content` 独立字段），唯一口径见 `docs/AI-FEATURES.md` + ARCHITECTURE ADR-9。**⚠ 只用文本、禁多模态（铁律 #36）；思考模式默认关**。**⚠ 2026-10-10 上游返回 `400 Arrearage`（百炼账号欠费），AI 能力全面不可用，待充值后复验** |
| 全站时间口径归一（UTC 库内 + 统一展示工具） | ✅ 上线（2026-09-20 深夜，见铁律 #25） |
| **对外 README**（19 张线上截图 + 架构/功能/部署详解） | ✅ 完成（2026-09-22，`npm run shots` 可一键重截） |
| **登录后自助修改登录密码**（原密码校验 + 全端令牌吊销） | ✅ 上线（/api/me/password，2026-09-22） |
| 一键体检：`gap-check` / `integrity-check` / `audit-mobile` / `verify-security` | ✅ 就绪（2026-09-21，命令见 docs/AUDIT-2026-09-21.md 第五节） |
| **自动化测试体系（`npm run check`）**：ESLint 零告警 + Vitest **423 单测** + 导入自检 + 库体检 + 线上 e2e + README 自检 | ✅ 就绪（铁律 #35；单测数随能力增长，2026-10-10 更新） |
| **账号安全：登录后自助修改登录密码**（`POST /api/me/password`） | ✅ 上线（2026-09-21）—— 须验原密码（防会话劫持后锁死账号）+ 新密码不得与原密码相同 + **成功后吊销该用户全部 refresh token**；⚠ 纯 JWT 架构下 access token 是 2h 无状态凭证，故其他设备最长 2h 窗口内仍有有效凭证（要秒级全端失效需引入令牌版本号，当前规模不做）；入口在顶栏用户名下拉 |
| 安全响应头（静态层 CSP/HSTS/nosniff 等）+ 前端全局错误兜底 | ✅ 上线（2026-09-21 体检修复，见铁律 #29/#30） |
| 邮箱附件上传发信 / 邮箱用量统计 | ❌ 未开始 |
| 图片图床接入（当前 /api/blob LONGBLOB 暂存，32 条 1.15MB） | ❌ 待接（只换 ImgUploader/blob.js 的 URL 生成） |
| 图书封面（420 本**全部**无封面，显示首字占位） | ❌ 未处理 |
| **Element Plus 按需引入** | ✅ 已完成（2026-09-21）：EP 单包 1088KB→最大 chunk 172KB、gzip 341KB→~145KB，见铁律 #33 |
| ~~uni-app 小程序端~~ | ❌ **已决策砍掉**（2026-09-20）→ 替代为「移动端 H5 适配 + App 壳封装」，理由见 PRD §4 |
| **移动端 H5 适配**（替代方案主体） | ✅ 已上线（门户壳汉堡+抽屉 / 表单与对话框全宽 / 网格 minmax(0,1fr) / 五页溢出归零；PC 端实测"移动端 DOM 数=0、侧栏仍 196px"零改动） |
| App 壳封装出 APK | ❌ 未开始（本机无 Java/Android SDK/Gradle，须云打包或另配工具链；PWABuilder 在线 TWA 为零环境首选路径，见第 8 节） |
| 全流程演示彩排 | ❌ 未开始（论文正文已成稿：Desktop/论文初稿10.6.docx 为唯一权威版） |

## 8. 下一步建议（优先级序）

0. **【已完成 ✅ 2026-10-10】AI 融合（C1~C13 共 13 项能力全部上线）**：毕业设计选题确定为必须与 AI 融合，现已落地。模型 **qwen3.8-omni-flash**（阿里云 DashScope OpenAI 兼容 `https://dashscope.aliyuncs.com/compatible-mode/v1`，⚠ 仅国内站可用；该 key 实为**聚合网关**，`/models` 有 262 个模型，别按官方文档预期配额；配置 `AI_QWEN_API_KEY / AI_QWEN_BASE_URL / AI_QWEN_MODEL / AI_PROVIDER` 在 `.env` 与 EdgeOne env，密钥严禁入库入文档；GLM 三键保留备用）。**★★ 开发测试期只用「文本输入→文本输出」，禁止任何多模态调用（铁律 #36）；思考模式默认 `enable_thinking: false`**（意图 JSON 快 6.2×、输出 token 降 94%，且关思考才解锁 `tool_choice: required`）。
   - **能力清单与安全边界唯一口径 = `docs/AI-FEATURES.md`**（含 C1~C13 详设、分级配色、实施计划 P0~P11 与每阶段验收）；选型口径 = ARCHITECTURE ADR-9；进度见 PROGRESS 阶段 6。
   - 三条主线：① `lib/ai.js` 统一出口（唯一调用点 + 超时降级 + **总开关守卫** + 上游错误分类）② 对话式操作（白名单注册表 + 两阶段确认 + `via:ai` 审计）③ 数据问答（模板问数 **+ C13 自由结构化查询**，**模型永不拼 SQL**）。
   - **体检结论见 `docs/AUDIT-2026-10-10-AI.md`**（越权 / 静默错误 / 总开关失效 / 频控 TOCTOU 四类问题的发现与修复）。
   - **⚠ 当前阻塞：上游返回 `400 Arrearage`（阿里云百炼账号欠费），AI 能力全面不可用**；充值后需重跑 `working/final-check.mjs`（C13 线上最终验收）与 `npm run eval:ai`（效果评估）。
1. **【移动端】H5 适配已完成 ✅，仅剩 App 壳打包**（替代原 uni-app 小程序计划，2026-09-20 用户决策）：
   - **为什么不做小程序**：①个人主体不能用 web-view（微信官方限制"仅支持非个人主体配置业务域名"）②纯 web-view 套壳极易被拒审（驳回原文"首页仅有一个 web-view、无小程序原生功能"，要求原生功能占视口 ≥15%）③小程序自身从 2023-09 起也强制 ICP 备案，教育类目对个人主体限制多
   - **为什么不能直接复用前端**：Element Plus 是 DOM 组件库，小程序无 DOM；Vue Router / Pinia / lucide / 现有 CSS 主题全需替换。**可复用的只有 Node Functions API + TiDB 表结构 + 外部集成**
   - **已完成**：`src/mobile.css`（媒体查询层，PC 零影响）+ `src/utils/device.js`（`useIsMobile`）+ PortalShell 汉堡与抽屉（`v-if="isMobile"`）+ 移动端网格单列化/溢出修复 + 表单对话框全宽 + 附带的驾驶舱 `[object Object]` 修复
   - **⚠ 打包 APK 环境现状**：本机**无 Java / Android SDK / Gradle**，无法本地出包。三条路径：Capacitor（需装 Android Studio）、**PWABuilder**（先把站点 PWA 化再加 manifest+SW，在线生成 TWA 版 APK，零本地环境）、**HBuilderX 云打包**（webview 壳，需 DCloud 账号）。注意 iOS 上架 App Store 会撞 Guideline 4.2（纯 webview 无原生能力必被拒），只做本地安装/演示则无影响
   - **移动端验收方法**（可复用）：`node .shots/capture.mjs`（Playwright + 系统 Edge；本地 preview 把 `/api/*` 用 `route.fetch` 转发到线上；断言 `document.documentElement.scrollWidth === innerWidth` 且 PC 视口下 `.shell-burger` 数量为 0）
2. **【低成本·见效快】图书封面补齐**：420 本全无封面。可用 picsum 随机图或按分类生成占位图，仅改 seed 脚本 + `lib_book.cover_url`。
3. **【低成本】邮箱增强**：附件上传发信（keaidang mail 支持 attachment）、管理员邮箱用量统计页。
4. **【中期】图片图床接入**：sys_blob（LONGBLOB，现 32 条/1.15MB）→ 对象存储，仅改 blob.js 与 ImgUploader 的 URL 生成，schema 不用动。
5. ~~**【工程优化】Element Plus 按需引入**~~ ✅ **已完成**（2026-09-21，见铁律 #33）：EP 单包 1088KB→最大 chunk 172KB（-84%）、gzip 341KB→~145KB（-58%），首页首屏 JS 最大仅 62KB。
6. **【收尾】演示彩排 + 论文正文**：素材沉淀见 ARCHITECTURE.md（选课并发控制 / 审批流两表引擎 / 云边协同三章核心素材）。
7. ~~**【数据清理】测试账号 zhreg2871**~~ ✅ 已处理（2026-10-07）：停用 + 注销对外邮箱 + 吊销全部刷新令牌 + 退宿（有住宿/邮件引用，硬删破坏关联，采用可逆软停用）；M4 验证产生的测试报修/请假（含流程实例）/站内信已全部清除。

## 9. 新会话开场白（复制即用）

> 读取 docs/HANDOVER.md 和最近 git log，总结当前项目状态，然后开始实现：［具体任务］。
> 遵守 HANDOVER.md 第 5 节铁律与 CONVENTIONS.md，不引入新依赖，完成后同步 docs 并提交推送。

## 演示数据（2026-09-19 批量生成，scripts/seed-demo.mjs，幂等可重跑）

- 规模：6 院系 / 14 班级（每班 28~31 人）/ **402 名学生 / 40 名教师 / 8 名辅导员 / 10 名校领导**；课程库 27 门，本学期教学班 59 个，选课记录约 2000 条
- 账号规则：`student004~student403`（学号 20261004+）、`teacher01~teacher40`（T2026xxxx）、`counselor01~08`（C2026xxxx）、`leader01~10`（L2026xxxx），**默认密码均为 `Zhihui@2026`**，学生账号有效期至 2027-07-31
- 每个班级均已指派辅导员；教师按院系随机排课（周一~周五 1-2节~9-10节）；学生每班选修本系 3~4 门 + 公共课，课表/选课/名册/成绩数据齐全
- 重建演示数据：`node scripts/seed-demo.mjs`（自动跳过已存在账号/班级/课程，可安全重复执行）

### 行政部门与行政人员（2026-09-20）

- 行政部门 10 个：校长室(xzs)、党委办公室(dw)、教务处(jwc)、学生工作处(xgc)、校团委(tw)、人事处(rsc)、财务处(cwc)、招生就业处(zjc)、后勤保障处(hqc)、图书馆(tsg)，共 29 名行政人员（leader 角色）
- 账号规则：部门编码小写+序号（如 `jwc01` 教务处、`xzs01` 校长室），工号 A2026xxx，**默认密码 `Zhihui@2026`**
- sys_department 新增 dept_type 字段（college=教学院系 / admin=行政部门）；开课院系下拉仅显示教学院系
- 重建：`node scripts/seed-admin-staff.mjs`（幂等，自动执行 schema-006）
