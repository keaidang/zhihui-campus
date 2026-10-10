# API · 接口约定

## 1. 统一响应格式

```json
{ "code": 0, "message": "ok", "data": {} }
```

- `code=0` 成功；非 0 为业务错误码
- 分页统一：`?page=1&pageSize=20`，返回 `data: { list, total, page, pageSize }`

## 2. 鉴权

- 除 `POST /api/auth/login`、`POST /api/auth/register` 外全部需要登录
- 请求头：`Authorization: Bearer <JWT>`
- Edge Functions 校验 KV 中的 session，Node Functions 校验 JWT 签名与角色

## 3. 常用错误码

| code | 含义 |
|---|---|
| 0 | 成功 |
| 40100 | 未登录 / token 失效 |
| 40103 | 登录状态已失效（guard.js） |
| 40301 | 无权限（guard.js HttpError，含数据范围越界） |
| 40400 | 资源不存在 |
| 41001~41006 | 管理端参数/归属/自锁类错误 |
| 42900 | 登录失败次数过多（限流锁定 10 分钟） |
| 42001~42006 | 教务线：参数/停选/重复选课/不存在/名额满/未选中 |
| 43001~43004 | 学工线：请假参数/不在审批中/不可销假/不存在 |
| 44001/44004/44005/44006 | 报修：参数或工单参数不合法 / 工单不存在 / 当前状态不允许该操作 / 无法处理未填原因 |
| 45001/45004 | 公告：参数/不存在 |
| 43501~43508 | 忘记密码：参数/账号邮箱不匹配/验证码错误过期/重置失败 |
| 43700~43704 | 自助改密（/api/me/password）：参数缺失 / 新密码长度不合法 / 与原密码相同 / 用户不存在或已禁用 / 原密码不正确 |
| 45005 | 失物招领（lf）：权限/状态类 |
| 46001~46015 | 图书借阅（lib）：参数/库存/在借上限/重复借/不存在/导入校验 |
| 47001~47004 | 图片 blob：参数/大小/类型/token 无效 |
| 48001~48019 | 社团（club）：参数/未过审/无权发布/停止/名额满/重复预约/未预约 |
| 49001~49102 | 论坛（forum）：参数/封禁/交易必填/板块不存在/权限 |
| 50000 | 服务器内部错误（同步落库 sys_op_log 供远程诊断） |
| 50001 | KV 不可用 |

## 4. 路径规范

- 前缀 `/api/{module}/{resource}`，实际落地用 GET + POST（EdgeOne Functions 环境简化）
- 管理端专用接口前缀 `/api/admin/...`；教务 `/api/edu/...`；学工 `/api/af/...`
- 写操作审计：管理端写操作 + 成绩录入/审批/工单处理/公告发布全部落 `sys_op_log`（guard.js opLog）

## 5. 接口清单（截至 2026-09-20，与代码同步）

### 5.1 认证（公开 / 需登录）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | /api/auth/register | 公开 | 注册：`{realName, username, password, email, code, prefix?, domain?}`；验证码校验（SQL 侧判过期）、prefix 双重占用校验、domain 白名单校验，默认 student 角色，分配校园邮箱 |
| POST | /api/auth/register/send-code | 公开 | `{email}` 发 6 位验证码（10 分钟，60s 重发/每邮箱日 10 封/每 IP 日 20 封），发件人 system@keaidang.com |
| GET | /api/auth/register/prefix-check?prefix=&domain= | 公开 | 校园邮箱前缀占用校验（库内 + 邮件服务器双重） |
| GET | /api/auth/register/domains | 公开 | 校园邮箱可选域名列表（keaidang mail 实时 active 域名，10 分钟缓存，兜底 keaidang.com） |
| POST | /api/auth/login | 公开 | 登录，返回双令牌 + user{roles} |
| POST | /api/auth/refresh | 公开 | 刷新令牌轮换（重放检测） |
| POST | /api/auth/logout | 登录 | 吊销刷新令牌 |
| GET | /api/auth/me | 登录 | 当前用户（含 user_no / dept / class / campus_email / mail_enabled + 数据库实时角色） |
| POST | /api/auth/password/forgot-send-code | 公开 | 忘记密码发码：`{username, email}` 账号+绑定邮箱匹配才发（purpose='reset'） |
| POST | /api/auth/password/forgot-reset | 公开 | `{username, email, code, newPassword}` 校验后重置 + 删 sys_refresh_token 吊销全部会话 |
| POST | /api/me/password | 登录 | **登录后自助修改登录密码**：`{oldPassword, newPassword}` —— 必须验原密码（防会话劫持后把真实用户锁在门外）；新密码 8~64 位且不得与原密码相同；成功后**吊销该用户全部 refresh token**（改密即视为口令可能已泄露）；原密码错误 10 分钟 5 次限流（DB 流水计数） |
| GET | /api/health | 公开 | 健康检查（db / jwtConfigured / protocol 诊断位） |

### 5.2 管理端基础（阶段 1 基础部分）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/admin/meta | admin / counselor | 角色列表 + 院系列表（含 dept_type）+ 班级列表 + 当前数据范围 |
| GET | /api/admin/users | admin / counselor | 分页用户列表，支持 keyword(含 campus_email) / role / deptId / status / lastLogin(never/30/60/90 僵尸筛选) 过滤（counselor 仅本院） |
| POST | /api/admin/users | admin / counselor | `{userId, action, value}`；action=`setStatus`(改启停) / `setRoles`(仅 admin) / `setProfile`(学号工号+院系班级) / `resetPassword`(仅 admin，随机密码+吊销会话) |
| GET | /api/admin/departments | admin / counselor | 院系列表（含用户数/班级数/dept_type） |
| POST | /api/admin/departments | admin | `{action: create \| setStatus \| update \| delete}`（下有人员或班级禁删） |
| GET/POST | /api/admin/classes | counselor(读)/admin(写) | 班级 CRUD（`create/update/delete`，有在读学生禁删；GET 返回辅导员名单） |
| GET/POST | /api/admin/courses | 登录(读)/admin(写) | 课程库 CRUD + 排课 CRUD + import.courses / import.schedule 批量导入；有教学班课程禁删、有选课排课禁删 |
| GET | /api/admin/mailbox | admin | 全量邮箱状态列表，**响应体不下发明文邮箱密码**；`?export=csv` 导出含明文密码的 CSV（高敏感，先写 opLog `mailbox.export` 再返回） |
| POST | /api/admin/mailbox | admin | 用户校园邮箱管理：`enable`(开对外收发，按 campus_email 域名建真实邮箱，随机密码) / `disable` / `resetPassword` / `viewPassword`(查看单个用户邮箱密码，写 opLog `mailbox.viewPassword`) / `updateAddress`(改前缀+域名，双占用校验) |
| — | 邮箱密码审计口径 | — | `mail_password` 目前**明文入库**（第三方邮箱凭据，业务需可取回）；明文只从 CSV 导出与 `viewPassword` 两条路径出去，二者均写 opLog；列表接口一律剥离该字段。**若要查看/导出密码，先查 `sys_op_log` 的 `mailbox.export` / `mailbox.viewPassword`**。详见 AUDIT-2026-09-21 P1-5 |

### 5.2.1 校园邮箱（需登录 + 已开通对外收发）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/mail | 收件箱列表（cursor 分页）；`?action=sent` 已发送列表（读 sys_mail_sent，60s 节流回查 keaidang mail 状态回写） |
| POST | /api/mail | `{to, subject, text?, html?}` 发信（发件人 system@，每日 50 封按 sys_op_log 计数，成功写 sys_mail_sent） |
| GET | /api/mail/detail?id= | 邮件详情（mailboxId 归属校验） |
| POST | /api/me/mail-password | 用户自助修改邮箱密码 |

### 5.3 鉴权中间件约定（node-functions/lib/guard.js）

- `requireAuth(context)` → JWT 载荷；`requireRoles(context, [codes])` → **角色实时查库**（令牌角色过期不影响判定），并返回 `deptId`
- `dataScope(roles, deptId)` → `{ type: 'all' | 'dept' | 'self' }`，业务 SQL 必须按此强制拼接 WHERE
- 角色编码：`student` / `teacher` / `counselor` / `leader` / `admin`
- 业务错误统一抛 `HttpError(code, message, status)`，`jsonError` 自动按其 status 返回（不再吞成 500）

### 5.4 教务线（M1，已上线验证）

> 学期口径 `TERM='2026-2027-1'`（API 内硬编码）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/edu/course | 登录 | 选课目录（课程+教学班+名额实时+`mine` 已选标记） |
| POST | /api/edu/course | student | `{action:'enroll'\|'drop', classId}`；事务+条件 UPDATE 防超卖，唯一键+upsert 防重选/重激活退课记录 |
| GET | /api/edu/timetable | student/teacher/admin | 周课表（学生=所选含已出分；教师=任教班） |
| GET | /api/edu/score | student | 成绩单 + summary（GPA/学分/已出分门数） |
| GET | /api/edu/score?classId= | teacher/admin | 教学班选课名单（含现有成绩） |
| POST | /api/edu/score | teacher/admin | `{classId, items:[{studentId, score}]}` 批量录成绩，等级自动换算，审计留痕 |
| GET | /api/edu/teach | teacher/admin | 我的教学班列表（admin 查全部）；`?classId=` 返回选课名单 |

### 5.5 学工线（M2，已上线验证）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/af/leave?status= | student=本人；staff=本院/全校 | 请假单列表（含审批意见） |
| POST | /api/af/leave | student | `{action:'apply', type, reason, startAt, endAt}`；同时建 flow_instance + flow_node |
| POST | /api/af/leave | counselor/admin | `{action:'approve'\|'reject', leaveId, opinion}`（counselor 仅本院） |
| POST | /api/af/leave | student | `{action:'back', leaveId}` 销假（已批准→已销假） |
| GET | /api/af/repair?status= | 本人 / staff 全部 | 报修工单列表 |
| POST | /api/af/repair | 登录 | `{action:'create', location, category, description, contact}` |
| POST | /api/af/repair | counselor/admin | `{action:'accept'\|'finish', id[, remark]}` 受理/完成；`{action:'reject', id, remark}` 标记无法处理（**remark 必填**，原因会通知报修人） |
| GET | /api/af/notice | 登录 | 公告列表（学生=全校+本院；staff 全部；置顶优先） |
| POST | /api/af/notice | teacher/counselor/admin | `{action:'publish', title, content[, deptId, pinned]}`；counselor/teacher 强制本院 |
| POST | /api/af/notice | 发布者/admin | `{action:'revoke'\|'pin', id}` 撤回/置顶（pin 仅 admin） |

### 5.6 审批流约定（flow_instance / flow_node）

- 请假单创建时同步生成：`flow_instance(biz_type='leave', status=1, current_node=1)` + `flow_node(node_order=1, handler_role='counselor')`
- 审批通过 → instance status=2；驳回 → 3；销假 → 4。后续奖助/调宿等审批复用同一套两表引擎
- 审批人权限校验：handler_role + 申请人 dept_id 与辅导员 deptId 匹配（admin 豁免）

**哪些业务接入了本引擎（口径，新业务接入前必读）**：
- **当前仅请销假**在用（`biz_type='leave'`）。报修（`af_repair`）与社团申请（`club_application`）是**单节点状态机，不建流程实例**——判据与对照表见 `docs/DATABASE.md`「审批流 vs 状态机」。
- 报修全项目**只有一个写入端点**（`/api/af/repair`）。⚠ 历史文档与审计报告曾记载"存在 `/api/dorm/repair` 另一条写入路径"，经 2026-09-21 全代码 + 全 git 历史核实：**该端点从未存在过，报修也从未建过流程实例**。

### 5.7 图片 Blob（M3）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | /api/blob | 登录 | `{mime, data(base64≤3MB)}` 存 sys_blob，返回 `{url:"/api/blob?token=<16位>"}` |
| GET | /api/blob?token= | 公开 | 图片只读（immutable 缓存）；**EdgeOne 函数不支持路径参数，必须查询串** |

### 5.8 图书借阅（M3，/api/lib）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/lib/books?keyword=&category=&page= | 登录 | 藏书检索/分页；admin 返回含管理字段 |
| POST | /api/lib/books | admin | action=`add`(单本) / `import`(CSV/JSON 批量，ISBN 去重，单批≤500) / `update` / `delete`；写操作审计 |
| POST | /api/lib/loans | 登录 | action=`borrow`（在借≤5、同书防重借、条件更新扣库存防超借）/ `return`（逾期标 status=2，admin 可代还） |
| GET | /api/lib/loans?scope=mine | 登录 | 我的借阅（含到期时间、逾期标记） |

### 5.9 失物招领（M3，/api/lf）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/lf/items?status= | 登录 | 全员浏览（含联系电话） |
| POST | /api/lf/items | counselor/admin | action=`create`（标题/描述/图片/联系方式）/ `close`（标记已认领，发布人或 admin） |

### 5.10 社团活动（M3，/api/club）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/club/apply?scope=mine | student | 我的申请；无 scope 时 teacher/admin 审批列表（?status=0 待审） |
| POST | /api/club/apply | student/teacher/admin | action=`create`（名称/开课位置/内容/大纲/时间必填）/ `review`（pass+opinion，teacher/admin） |
| GET | /api/club/recruit | 登录 | 招募列表（含剩余名额 + booked 我是否已预约）；**scope=mine 我的预约（join club_application 取地点/时间）** |
| POST | /api/club/recruit | 登录 | action=`publish`（审批通过后，teacher/admin 或开课人）/ `stop` / `book`（事务：占位+名额条件更新，唯一键防重）/ `cancel`（释放名额，可再预约） |

### 5.11 校园论坛（M3，/api/forum，全部需登录）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/forum/boards | 登录 | 板块列表（6 板块，含 is_trade 标记与帖子数） |
| GET | /api/forum/threads?boardId=&page= / ?id= | 登录 | 帖子列表（置顶优先）/ 详情（含回复）；封禁用户被拒 |
| POST | /api/forum/threads | 登录 | action=`create`（交易板块 item_name/price/contact 必填）/ `reply` / `edit` / `delete`（作者或 admin）/ `pin` `lock`（admin） |
| POST | /api/forum/moderate | admin | action=`ban`（禁言 user_id+until_at+reason）/ `unban` |

### 5.12 宿舍管理（schema-010，/api/dorm）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/dorm?view=my | 登录 | 我的宿舍（楼栋/房间/床位/入住时间/室友） |
| GET | /api/dorm?view=overview | admin/counselor | 楼栋+房间网格（含住户、入住进度） |
| GET | /api/dorm?view=students | admin/counselor | 未住宿学生清单（分配下拉用） |
| POST | /api/dorm | admin/counselor | action=`addBuilding`（性别属性楼栋）/ `addRoom` / `toggleRoom`（有住户拒停用）/ `assign`（事务 FOR UPDATE：容量+性别双重校验，自动分配最小床位号）/ `unassign`（退宿留历史，occupied 同事务维护） |

- 宿舍报修复用 `/api/af/repair`（学生提交时前端自动带出住宿位置）；**全项目仅此一个报修写入端点**
- 报修是**单节点受理工单（状态机）**，不建 `flow_instance`：0 待受理 → 1 处理中 → 2 已完成；0/1 均可 → 3 无法处理（终态，必填原因并通知报修人）
- sys_user.gender（0未知 1男 2女）为分配约束依据
- 错误码：49201 参数 / 49202 重复 / 49203 性别不符 / 49204 不存在 / 49205 停用冲突 / 49206 已满员 / 49207 已在住

### 5.13 站内信 / 站内通知（schema-011，/api/notice/messages）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/notice/messages?scope=all\|unread&page= | 登录 | 我的消息（含未读数、分页 20/页） |
| GET | /api/notice/messages?view=recipients | teacher/counselor/admin | 可选接收学生清单 |
| POST | /api/notice/messages | 登录 | action=`read` / `readAll` / `delete`（本人消息）；`send`（teacher/counselor/admin：target=`user`/`role`/`all`，all 仅 admin） |

- 自动通知接线：请假审批结果（lib → af/leave.js approve/reject）、社团审批结果（club/apply.js review）、报修受理/完成（af/repair.js）；统一走 lib/notify.js（尽力而为，失败不影响主业务）
- sys_message：sender_id=0 为系统通知；biz 标记来源业务（leave/club/repair/manual）；错误码 49301

### 5.14 数据驾驶舱（M4，/api/admin/dashboard）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/admin/dashboard | admin/leader | 全校聚合只读：用户/性别/各院系分布、教务（课程/选课/成绩）、学工（请假/报修/待审）、宿舍床位、生活服务（图书/社团/论坛）、近 7 日登录趋势、最近 10 条管理动态 |


### 5.15 AI 能力（schema-012，/api/ai，全部需登录）

> 统一口径见 **ARCHITECTURE ADR-9** 与 **docs/AI-FEATURES.md**。模型 qwen3.8-omni-flash（阿里云 DashScope 兼容网关），统一出口 `lib/ai.js`（**思考模式默认关**、失败一律返回 null 由调用方降级、绝不抛异常）。**铁律 #36：只用文本，不接收任何图片/音频/视频字段。**

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/ai/status | 登录 | 按角色返回可用能力：`{ provider, model, configured, roles, variant, variantLabel, features{}, catalog[], suggestions[], degraded, degradedReason }`。`variant` ∈ standard/counselor/leader/admin（**取高不取低**，admin 兼 student 时为 admin），前端据此换主标识色并渲染能力项 |
| POST | /api/ai/chat | 登录 | **C1 校园智能问答（流式）**。入参 `{ question, history? }`（question ≤500 字，history 取末 6 条、每条截 400 字） |
| GET | /api/ai/stream-probe | 登录 | 流式能力探测（诊断用，**部署后判定平台是否真增量推送**；已实测：EdgeOne Node Functions 支持） |

**`POST /api/ai/chat` 响应协议（重要）**

- **成功 → `text/event-stream`**，事件序列：

  | 事件 | data | 说明 |
  |---|---|---|
  | `meta` | `{ variant, mode, sources:[{id,title,category}], model }` | **先于内容发出**；`mode` = inline(全量注入) / retrieve(TopK 召回) / empty(未命中) |
  | `delta` | `{ text }` | 增量文本，逐片到达（实测平台真流式） |
  | `done` | `{ usage, len }` | 上游 usage 为真值（网关流式响应自带，含 cached_tokens） |
  | `error` | `{ message }` | 生成中途异常；**其后仍会补 `done`**，保证客户端一定能收尾 |

- **失败 → 普通 JSON `{code,message}`**（不是 SSE）。这样"根本没开始生成"的错误有干净语义，前端把 message 当**一条助手消息**展示，页面不报错。校验/开关在调用上游**之前**完成，避免为无效请求消耗额度。

| code | HTTP | 触发 |
|---|---|---|
| 49400 | 503 | AI 未配置（服务端缺 `AI_QWEN_API_KEY`） |
| 49401 | 400 | 问题为空或超 500 字 |
| 49429 | 429 | 频控超限（DB 流水计数：默认 10 次/分、200 次/日，铁律 #23 禁内存计数） |
| 49430 | 503 | `ai.enabled` / `ai.chat.enabled` 关闭，或上游调用失败（已降级） |

- 运行时开关读 `sys_config`（**改完 30 秒内生效，无需重新部署**，铁律 #5 的产物）；知识注入 `L0 固定档案 + L1 条目`，阈值 `ai.kb.inline_max_chars`=4000、召回条数 `ai.kb.top_k`=5，另加分数门槛（`minScore`=3 + 相对门槛 `minRatio`=0.25）与**近似话题去重**（同一话题的"短 FAQ + 详细条目"只留正文更完整的那条）
- **提问者身份注入（`lib/ai-identity.js`）**：system prompt 中位于"回答纪律"之后、"平台档案/资料"之前，含**本人**姓名/账号/角色/所属部门 + 该角色的真实能力边界与数据范围（`ROLE_SCOPE`，须与 PortalShell MENUS 同源）。这是为了让 AI 称呼与能力判断正确——**不要把非学生用户当学生**，也不要输出"如果你是学生…如果你是辅导员…"这类并列假设。身份只来自数据库，绝不接受前端传参
- 每次调用落 `ai_usage_log`（user_id/kind/model/prompt_tokens/completion_tokens/ok/cost_ms），供频控与论文统计

### 5.16 AI 智能管理（C2 审核 / C5 对话式执行，/api/ai）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | /api/ai/action | admin / counselor / teacher | **C5 对话式执行**。两阶段：`{text}` → 只读动作直接返回结果；写动作返回 `{preview, confirmToken}`（**未改任何数据**）；`{confirmToken}` → 真正执行 |
| GET | /api/ai/review | admin | **C2** 审核队列 / 日志：`?handled=0\|1\|2\|all&page=` |
| POST | /api/ai/review | admin | `{ id, action: 'confirm_violation'\|'false_positive', penalty? }` 人工复核处置 |

**`POST /api/ai/action` 协议**

- 第一阶段 `{ text }` → `{ intent:{action,label}, kind, ... }`，`kind` 三种：
  - `read`  → `{ rows:[...], summary }`（直接返回结果表）
  - `write` → `{ preview:{count, items:[{id,label}], truncated, skipped:[{label,reason}], warnings[]}, confirmToken }`，**此时一行数据都没改**
  - `none`  → `{ reply, sources }`（不是一条系统指令，用同一份知识库正常作答）
- 第二阶段 `{ confirmToken }` → `{ result:{ message, affected[], skipped[] } }`

**安全边界（实现见 `lib/ai-actions.js`，测试见 `tests/unit/ai-actions.spec.js`）**

- 模型只做「意图分类 + 参数抽取」，**永不生成 SQL、永不直接执行**；`action` 必须在白名单注册表内
- 批量写操作必须由模型明确给出 `all:true` **且**带 `role`/`keyword` 范围；只给模糊描述时拒绝执行（49402）
- 确认令牌：JWT HS256、5 分钟、`audience=ai-confirm`、**绑定操作者 `sub`**（他人拿到无效）；执行前**重新解析目标**并如实报告"已失效"（49405）
- 目标解析阶段即剔除"自己""管理员账号""状态已一致"的项，并在确认清单里显示跳过原因
- 执行一律调 `lib/services/*`（与人工点按钮同一份权限与审计），审计 `detail` 带 `via:ai` 前缀（铁律 #4）

**动作清单（按角色可见；学生与校领导不可见任何动作）**

| kind | action | 角色 |
|---|---|---|
| read | `query_users` / `query_leaves` / `query_notices` / `query_review_queue` | admin、counselor（公告查询含 teacher） |
| write | `disable_users` / `enable_users` | admin、counselor（限本院） |
| write | `approve_leaves` / `reject_leaves` | counselor、admin |
| write | `publish_notice` / `revoke_notice` | teacher、counselor、admin |
| write | `pin_notice` / `confirm_violation` | admin |

### 5.17 AI 模块错误码（49400~49499）

| code | HTTP | 含义 |
|---|---|---|
| 49400 | 503 | AI 未配置 |
| 49401 | 400 | 入参为空或过长 |
| 49402 | 400 | 意图无法识别 / 未给出可执行范围 |
| 49403 | 403 | 该角色无权执行该 AI 操作 |
| 49404 | 400 | 确认令牌无效或已过期 |
| 49405 | 400 | 待确认操作已失效（目标状态在确认期间变化） |
| **49406** | **503** | **请求体不可读（平台偶发消费请求体）→ 可重试** |
| 49429 | 429 | AI 调用过于频繁（DB 流水频控 + 在途标记） |
| 49430 | 503 | AI 服务暂时不可用（已降级） |
| 49431 | 400 | 知识库/审核记录不存在 |

> **49431 只表示"记录不存在"**。2026-10-10 修掉一处误用：`api/ai/review.js` 曾用它表达
> "不支持的操作" —— 那会让排查方向跑偏（去查记录，而问题其实在入参），已改为 **49401**。
>
> **★ 49430 不是一句笼统的"不可用"**（2026-10-10 新增可诊断分类）。
> `lib/ai.js` 的 `classifyUpstreamError(status, body)` 把上游错误分成六类，
> 落库为 `ai.error` 的 `upstream.http.<kind>` / `chat.http.<kind>`，远程一眼可辨：
>
> | kind | 触发 | 用户可见提示 |
> |---|---|---|
> | `arrearage` | 上游返回 `Arrearage` / `overdue` / 含"欠费" | "AI 服务账号欠费或状态异常，请联系管理员到阿里云百炼控制台处理" |
> | `rate_limit` | 429 / `Throttling` / `RateLimit` | "当前请求过多，请稍后再试" |
> | `auth` | 401 / 403 | "密钥无效或无权限，请联系管理员检查配置" |
> | `model_missing` | `Model ... not ...` | "配置的 AI 模型不可用" |
> | `timeout` | 含 `timeout` | "响应超时，请稍后再试" |
> | `unknown` | 其它 | "暂时不可用，请稍后再试" |
>
> 背景：曾把持续 400 归为"上游网关抖动"，翻 `sys_op_log` 才发现真因是
> **账号欠费（`Arrearage`）** —— 账单问题被当成了网络问题，排查绕了一大圈。
> **规范：`unknown` 一律不臆测原因**（尤其不能默认说成欠费），单测里有专门一条锁住这点。


### 5.18 AI 能力接口（P8：C7~C12）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/ai/study | student | **C7 学业概览**（学分/绩点/挂科/本学期课表）。纯 SQL 汇总，**不消耗 AI token** |
| POST | /api/ai/study | student | **C7 学业问答**。`{ question, history? }` → SSE（协议同 5.15 的 `/api/ai/chat`） |
| POST | /api/ai/lib-search | 全员 | **C12 图书自然语言检索**。`{ question }` → `{ books[], parsed:{keyword,category}, note, degraded }`（**不生成自然语言答案，只回结构化书目**） |
| GET | /api/ai/anomaly | admin | **C11 立即扫描**。纯 SQL 规则检测，返回 `{ findings[], checkedAt }`，**不发邮件** |
| POST | /api/ai/anomaly | admin | `{ notify?:boolean=true }` 扫描并按需邮件通知；`notify=false` 时只返回结果 |

**被 AI 增强的既有端点（开关关闭时行为与改造前完全一致）**

| 端点 | 增强点 |
|---|---|
| `POST /api/af/repair`（create） | 响应多返回 `data.triage = { dept, urgency, urgencyLabel, selfService, suggestion }`；写入 `af_repair.ai_triage`。**分诊超时/失败 → 返回 null，工单照常创建** |
| `GET /api/af/repair` | 每条工单多返回 `triage`（由 `ai_triage` 文本解析；解析不出则给 `{raw}`） |
| `POST /api/af/notice`（publish） | 响应多返回 `data.summary`；写入 `af_notice.summary` |
| `POST /api/af/notice`（**新增 action=summary**） | `{ action:'summary', id }` 为已有公告补摘要（作者本人或超管） |
| `GET /api/af/notice` | 列表多返回 `summary` 字段 |
| `POST /api/lf/items`（create） | 响应多返回 `data.matches = [{ id, title, score, reason }]`（≥0.6 才返回）；命中产生**双向**站内信 |

**安全与降级边界（实现见各 `lib/ai-*.js`，测试见 `tests/unit/ai-p8.spec.js`）**

- **C7 零越权入口**：`student_id` 在 SQL 里硬编码为当前登录用户，请求体**不接受** `studentId` 参数（不是"判断了权限"，而是"没有可越权的入口"）
- **C7 口径唯一**：学分/绩点来自 `lib/edu-stats.js`，与成绩页面 `/api/edu/score` **同源**（口径不一致会让同一系统给出两个答案）
- **C8 白名单**：责任部门只能是 `TRIAGE_DEPTS` 之一，非法值归「其他」；紧急度非法值降级为 `normal`
- **C8 不阻塞**：`ai.triage.timeout_ms`（默认 3000）为硬上限，超时即放弃分诊
- **C9 不阻塞**：摘要生成失败只留空串，公告照常发布；摘要硬截断 80 字
- **C10 服务端二次校验**：模型给的 id 必须存在于候选清单（模型会编 id）、score 夹到 [0,1]、低于阈值丢弃
- **C11 规则优先**：检测全用 SQL（确定性、可复现、零 token），模型只做摘要归纳；findings 为空不发邮件；邮件按天去重
- **C12 不生成 SQL**：模型只输出「关键词 + 分类」，分类过 `LIB_CATEGORIES` 白名单，`% _ \` 一律剔除；AI 不可用时退化为整句关键词检索


### 5.19 AI 效果评估（仅超管，只读）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/ai/eval | admin | 返回场景目录 + 数据集规模 + **各场景最近一次运行结果**（含准确率、误报率、耗时、未通过用例明细） |

**为什么没有"运行评估"的写接口**：一轮完整评估要调 30 次模型、耗时 1~2 分钟，
超出边缘函数单次执行预算；放接口必然顶到平台超时，而平台超时重试会撞上
"请求体已被消费"（铁律 #38）变成难查的 500。因此**跑分放本地脚本、结果落库**：

```bash
npm run seed:eval                       # 写入/更新标注数据集（幂等，含两重自检）
npm run eval:ai                         # 跑全部场景
npm run eval:ai -- --scene triage       # 只跑某个场景
```

数据表：`ai_eval_case`（标注用例）+ `ai_eval_run`（运行记录，保留全部历史）。
方法与结果见 **`docs/AI-EVAL.md`**。


### 5.20 通用结构化查询（C13）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | /api/ai/action | admin / counselor / teacher | 第四类意图 `query`（与 action / insight / 问答共用一次调用） |
| POST | /api/ai/insight | leader / admin | 同上，供校领导使用 |

**为什么需要它**：改造前只有 10 个问数模板，「学生账号总数」只能退化成"列出 50 条明细" ——
能力上限 = 模板数量。C13 让模型输出**结构化查询描述**，服务端编译成参数化 SQL，
表达力接近 SQL，而安全边界一点没松。

**协议（`query` 字段）**

```json
{ "entity": "score",
  "metrics": { "gpa": 1 },
  "groupBy": ["realName"],
  "filters": [{ "field": "createdAt", "days": 90 }],
  "orderBy": { "field": "gpa", "dir": "asc" },
  "limit": 5 }
```

**响应（`kind: "data"`，`viaQuery: true`）**

```json
{ "isAggregate": true, "scalar": null,
  "rows": [{ "姓名": "程泽晓", "绩点": 1.17 }],
  "summary": "共 5 个姓名分组，其中姓名「程泽晓」的绩点最高（1.17）。",
  "metrics": ["绩点"], "groupBy": ["姓名"] }
```

`scalar` 非空时前端**只显示一句话、不渲染表格**（问"总数"时用户要的是一个数字）。

**可查实体（6 个）**

| entity | label | 可用角色 | 特色指标 |
|---|---|---|---|
| `user` | 账号 | admin / counselor / leader / teacher | 人数 |
| `score` | 成绩 | admin / counselor / leader | **绩点**（口径引用 `lib/edu-stats.js`，不及格不计入分母）、不及格门数、不及格率 |
| `leave` | 请假单 | admin / counselor / leader | 总天数、平均天数、涉及人数 |
| `repair` | 报修工单 | admin / counselor / leader | 待受理数 |
| `loan` | 图书借阅 | admin / counselor / leader | 逾期未还数 |
| `forum` | 论坛 | admin / counselor / leader | 回复总数 |

**安全边界（实现见 `lib/ai-query.js`，测试见 `tests/unit/ai-query.spec.js`）**

1. 标识符（SELECT / GROUP BY / ORDER BY）全部来自白名单，SQL 片段由 `lib/ai-entity.js` 写死
2. 筛选值一律 `?` 占位符；`LIKE` 的 `% _ \` 被剔除（不让模型控制通配行为）
3. **数据范围强制注入**：scope 由服务端按角色拼进 WHERE，模型既看不到也改不掉；
   模型即使输出 `filters` 指定别的院系，注入条件仍与之 AND —— 越权语法上不可能
4. `LIMIT` 硬夹：明细 20 / 聚合 10 / 绝对上限 50
5. `JOIN` 片段写死在注册表，模型不能新增表或改连接条件
6. `ORDER BY` 只能按数值/时间字段或指标别名（文本排序无意义且慢）
7. 一次最多 2 个分组维度、6 个筛选条件（防组合爆炸与慢查询）
8. 角色无权 → `49403`（在 scope 之前就拒，不靠错误码探测实体是否存在）


## 6. 未实现模块端点（规划，实现后在此补充）

### 外部图书馆系统对接（预留）
- `lib_book.ext_source/ext_id` 已预留；对接时在 lib/books.js 增加同步入口即可

<!-- TODO: 每完成一个模块，把实际实现的端点补充到这里 -->
