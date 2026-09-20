# HANDOVER · AI/开发者交接文档

> 最后更新：2026-09-20。**新会话/新 Agent 开工前必读本文档**，再按需读 docs/ 其他文档。
> 一句话现状：智汇校园已上线 https://c.9o.pw/ ，认证 + 五角色 RBAC + M1 教务线 + M2 学工线 + 校园邮箱体系 + **M3 生活服务五模块（图书借阅/失物招领/社团活动/校园论坛/忘记密码）** 全量可用，演示数据齐全。

## 1. 项目快照

| 项 | 值 |
|---|---|
| 项目 | 智汇校园 —— 一站式智慧校园服务平台（毕业设计） |
| 论文标题（定稿） | 《基于云边协同与 Serverless 架构的"智汇校园"一站式服务平台设计与实现》 |
| 线上地址 | **https://c.9o.pw/**（EdgeOne Pages，git push 后约 2.5~3 分钟自动部署；旧地址 campus.keaidang.com 仍可用） |
| 仓库 | github.com/keaidang/zhihui-campus（main 分支） |
| 技术栈 | Vue3 + Element Plus + Pinia（前端）/ EdgeOne Node Functions（业务 API）/ TiDB Cloud Serverless（MySQL 8.0 兼容）/ LanQin Email 开放 API（邮件） |
| 虚拟学校 | 清北大学（校徽 public/logo.webp、书法校名 public/name.webp）；页脚备案 苏ICP备2026056678号 · 鲁ICP备2025186072号 并列 |
| 本地路径 | `C:\Users\Administrator\Desktop\zhihui-campus` |

## 2. 演示账号（TiDB 里真实存在）

| 账号 | 密码 | 角色 | 备注 |
|---|---|---|---|
| **admin** | **admin** | admin+student | 超管（2026-09-18 用户指定弱密码，答辩演示用） |
| teacher01 | Zhihui@2026 | teacher | 王志远 T2001001，任教 3 个教学班 |
| counselor01 | Zhihui@2026 | counselor | 刘慧敏，计算机学院（本院数据范围） |
| student01 | Zhihui@2026 | student | 陈晓东 20261001，**已有选课+92 分成绩数据，勿清库** |
| student02 / student03 | Zhihui@2026 | student | 林小雨 / 赵子墨 |
| student004 | Zhihui@2026 | student | **M3 主测试号**：有借阅记录、AI 兴趣社 1 条预约、论坛发帖；社团预约数据已打散，其余社团可直接预约 |

- 建号/授权/重置密码：`& node.exe scripts/grant-role.mjs <user> <role> [--create] [--reset] [--name=姓名] [--no=学号]`
- SQL 迁移：`& node.exe scripts/migrate.mjs database/schema-NNN-*.sql`（幂等，可重复跑）
- **当前学期口径 `TERM='2026-2027-1'`** 硬编码在 edu 相关 API，换学期需统一修改
- 邮箱测试账号：zhreg2871（RegTest@2026，校园邮箱 zhnewuser94@keaidang.com，已开通对外收发）——确认无用后可删除

## 3. 代码地图

```
├─ docs/                      # 文档（单一事实来源，先改文档再改代码）
├─ database/                  # schema-001~008（auth/base/edu/affair/org/行政部门/校园邮箱/发件表）+ schema-009-m3-modules（M3 十一张表）
├─ node-functions/
│  ├─ lib/                    # db.js(连接池+瞬时错误重试，query()直接返回rows) http.js guard.js auth.js lanqin.js(邮件API封装)
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
├─ edge-functions/            # KV 诊断位（kv-check 等）
├─ src/
│  ├─ api/request.js          # 统一请求封装（Bearer + 401 自动刷新重放）
│  ├─ stores/auth.js          # Pinia：双令牌，accessToken 仅内存；restoreSession/tryRefresh 单飞 Promise（防 F5 竞态）
│  ├─ router/index.js         # 路由 + 登录/角色守卫（redirect 回跳；M3 五路由均 requiresAuth）
│  ├─ components/PortalShell.vue  # 门户骨架 + 校园实景背景 + 按角色菜单
│  ├─ components/ImgUploader.vue  # 图片上传：canvas 压缩 1280px/JPEG 0.85 → POST /api/blob，v-model 数组
│  └─ views/
│     ├─ HomeView.vue         # 门户首页（SSO 联动）
│     ├─ LoginView.vue        # 登录/注册一体：注册带邮箱验证码 + 校园邮箱前缀 + 域名后缀下拉
│     ├─ WorkbenchView.vue    # 工作台：账号卡 + 功能矩阵 + 校园邮箱卡 + 常用资源横排
│     ├─ MailView.vue         # /mail 收发件页（收件箱/已发送/详情/写邮件，lucide 图标）
│     ├─ m3/                  # LibraryView LostFoundView ClubView ForumView ForumThreadView ← M3
│     ├─ admin/               # UserManageView（含邮箱管理/僵尸筛选/CSV 导出） StudentManageView OrgManageView CourseManageView
│     ├─ edu/                 # ElectView ScoresView TeachView ScoreEntryView
│     └─ af/                  # LeaveView ApproveView RepairView RepairManageView NoticeView
└─ scripts/                   # migrate.mjs grant-role.mjs seed-demo.mjs seed-admin-staff.mjs seed-m3.mjs cleanup.mjs（白名单制）
```

### 校园邮箱体系（2026-09-20 上线，关键口径）

- **注册**：外部邮箱收 6 位验证码（10 分钟有效，SQL 侧 `expires_at > NOW()` 判过期；60s 重发/每邮箱日 10 封/每 IP 日 20 封）。可选填校园邮箱前缀（默认学号/工号），域名后缀下拉从 `/api/auth/register/domains` 实时拉取（LanQin 6 个 active 域名，后端白名单校验），默认角色学生
- **开通**：管理员在账号管理页"开通对外收发"才调 LanQin 创建真实邮箱（`createMailbox` 带 `userId=LANQIN_OWNER_USER_ID` 归属主用户），随机密码管理员可见/可导出 CSV，用户在工作台自助改密
- **收发**：/mail 页收件箱（LanQin messages，cursor 分页）+ 已发送（本地 `sys_mail_sent` 表）+ 写邮件（每日 50 封限额）；发信统一用 system@keaidang.com；已发送状态对 queued/sending 记录用 GET /send/{id} 实时回查（模块级 Map 60s 节流、单次最多 8 封）
- **发件归属铁律**：LanQin POST /mailboxes 不传 userId 会把邮箱挂到自动新建的独立用户 → /send 404 "mailbox not found"。归属修复前开通的旧邮箱连 messages 也 404，需删旧邮箱 + 重置 mail_mailbox_id 重新 enable
- LanQin GET /send 历史列表接口常超时，已弃用；验证发件最可靠的方式是直接发真实邮箱看原文

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

## 4. 五角色与页面权限（已定稿，勿动摇）

| 角色 | 主题色 | 菜单/能力 |
|---|---|---|
| student | 统一学术风 | 选课、成绩课表、请销假、报修、公告 |
| teacher | 统一学术风 | 我的课程、成绩录入、公告发布（本院） |
| counselor | 统一学术风 | 请假审批（本院）、报修处理、学生名册（本院）、公告 |
| leader | 统一学术风 | 纯只读，M4 驾驶舱（未做），公告 |
| admin | 统一学术风 | 全部 + 用户/角色管理独占 |

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
13. **LanQin POST /mailboxes 必须带 userId**（LANQIN_OWNER_USER_ID env），否则发件 404 归属失败；LANQIN_* 密钥在 .env 与 EdgeOne env，严禁入库
14. **窄卡片里禁止用 `el-input` 的 `#append`/`#prepend` 插槽**：Element Plus 会渲染成 `display:table` 的 `.el-input-group`，在 ~340px 内容区里追加按钮会把输入区挤到只剩几十像素。统一用「输入框与按钮/下拉做兄弟节点」的 flex 行布局（见 LoginView.vue `.field-row`），并覆盖 `.gate-card .el-button` 的全局 6px 字距
15. **前缀校验接口耗时 4~10s**（后端要查 LanQin 邮箱列表），前端不做逐字自动校验，仅"检查可用性"按钮显式触发 + 前端 14s 超时兜底；注册提交本身不依赖该校验结果（后端注册时会再校验）
16. **验证线上部署别只比 bundle hash**：EdgeOne 构建环境与本地不同，同一份代码 hash 可能不一致。可靠做法是取线上对应懒加载 chunk（路由组件是独立文件，不在 index 主包），grep 新版代码的特征类名/字符串（注意构建产物中中文会被转义成 \uXXXX，用 ASCII 类名如 field-row 最稳）
17. **EdgeOne node functions 不支持路径参数**：`/api/xx/<id>` 落回 SPA 返回 index.html——动态参数一律用查询串（`/api/blob?token=xxx`）
18. **EdgeOne POST body 缺键偶发 "Body has already been read" 500**：服务端先把缺失键归一化（`?? '' / null`）再校验；前端表单始终发全量字段
19. **写 SQL 前对照真实 DDL 引用字段**（尤其跨表 join）——club_recruit 无 location/activity_time 曾致 scope=mine 恒 500；新 GET 分支冒烟要覆盖每一条查询路径，不能只测写操作
20. **M3 图片一律走 /api/blob**：POST base64≤3MB 存 sys_blob，GET ?token= 公共只读；URL 必须匹配 `/^\/api\/blob\?token=[a-z0-9]{16}$/`（存量数据已从此前的路径式迁移）
21. **v-html 必须过 DOMPurify**：用户/外部内容（邮件正文等）渲染前消毒（MailView.vue 先例）；全站其余内容一律纯文本渲染，新增 v-html 前先想安全
22. **运维清理**：login.js 登录成功 5% 概率顺带清过期刷新令牌；blob/登录日志用 `node scripts/cleanup.mjs`（默认 dry-run，--yes 执行，参数 --blob-days/--log-days）

## 6. 交付与验证流程

1. 改代码 → `npm.cmd run build`（前端构建必须过）
2. `git add -A && git commit` → push（凭据在 Windows 凭据管理器；`git -c credential.helper= push <user:pass 编码后的 url> main`）
3. 等约 2.5~3 分钟部署（部署未完成时新旧函数混跑会出"诡异 500"，先等满再测）→ 线上验证
4. **推荐验证方式**：写一次性 Node 22 脚本（原生 fetch）直打线上 API 全链路（登录拿 token → 逐接口断言 → 结果落盘），跑完即删。参考已删除的 verify-m1m2.mjs 模式：学生选课→防重→辅导员审批→销假→报修→教师录成绩→学生查成绩→越权回归 40301
5. 收尾必须同步 docs（见 CONVENTIONS.md 会话纪律）

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
| M4 校领导驾驶舱 | ❌ 未开始（leader 菜单有占位） |
| 邮箱附件上传发信 / 邮箱用量统计 | ❌ 未开始 |
| 图片图床接入（当前 /api/blob LONGBLOB 暂存） | ❌ 待接（只换 ImgUploader/blob.js 的 URL 生成） |
| uni-app 小程序端 | ❌ 未开始 |

## 8. 下一步建议（优先级序）

1. M4 驾驶舱（`requireRoles(['admin','leader'])` + scope=all + 聚合统计）
2. 图片图床接入（sys_blob → 对象存储/图床，仅改 blob 服务与 ImgUploader）
3. 图书封面上批量补图（现在多数书无封面，显示首字占位）
4. 邮箱增强：附件上传发信、管理员邮箱用量统计
5. 论文素材沉淀：选课并发控制（db.js 防超卖范式）、审批流两表引擎、云边协同架构（ARCHITECTURE.md 已有口径）

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
