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
| 44001~44004 | 报修：参数/已受理/不可完成/不存在 |
| 45001/45004 | 公告：参数/不存在 |
| 43501~43508 | 忘记密码：参数/账号邮箱不匹配/验证码错误过期/重置失败 |
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
| GET | /api/auth/register/domains | 公开 | 校园邮箱可选域名列表（LanQin 实时 active 域名，10 分钟缓存，兜底 keaidang.com） |
| POST | /api/auth/login | 公开 | 登录，返回双令牌 + user{roles} |
| POST | /api/auth/refresh | 公开 | 刷新令牌轮换（重放检测） |
| POST | /api/auth/logout | 登录 | 吊销刷新令牌 |
| GET | /api/auth/me | 登录 | 当前用户（含 user_no / dept / class / campus_email / mail_enabled + 数据库实时角色） |
| POST | /api/auth/password/forgot-send-code | 公开 | 忘记密码发码：`{username, email}` 账号+绑定邮箱匹配才发（purpose='reset'） |
| POST | /api/auth/password/forgot-reset | 公开 | `{username, email, code, newPassword}` 校验后重置 + 删 sys_refresh_token 吊销全部会话 |
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
| GET | /api/mail | 收件箱列表（cursor 分页）；`?action=sent` 已发送列表（读 sys_mail_sent，60s 节流回查 LanQin 状态回写） |
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
| POST | /api/af/repair | counselor/admin | `{action:'accept'\|'finish', id, remark}` 工单流转 |
| GET | /api/af/notice | 登录 | 公告列表（学生=全校+本院；staff 全部；置顶优先） |
| POST | /api/af/notice | teacher/counselor/admin | `{action:'publish', title, content[, deptId, pinned]}`；counselor/teacher 强制本院 |
| POST | /api/af/notice | 发布者/admin | `{action:'revoke'\|'pin', id}` 撤回/置顶（pin 仅 admin） |

### 5.6 审批流约定（flow_instance / flow_node）

- 请假单创建时同步生成：`flow_instance(biz_type='leave', status=1, current_node=1)` + `flow_node(node_order=1, handler_role='counselor')`
- 审批通过 → instance status=2；驳回 → 3；销假 → 4。后续奖助/调宿等审批复用同一套两表引擎
- 审批人权限校验：handler_role + 申请人 dept_id 与辅导员 deptId 匹配（admin 豁免）

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

- 宿舍报修复用 `/api/af/repair`（学生提交时前端自动带出住宿位置）；sys_user.gender（0未知 1男 2女）为分配约束依据
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


## 6. 未实现模块端点（规划，实现后在此补充）

### 外部图书馆系统对接（预留）
- `lib_book.ext_source/ext_id` 已预留；对接时在 lib/books.js 增加同步入口即可

<!-- TODO: 每完成一个模块，把实际实现的端点补充到这里 -->
