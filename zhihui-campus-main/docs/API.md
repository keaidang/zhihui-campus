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
| 50000 | 服务器内部错误（同步落库 sys_op_log 供远程诊断） |
| 50001 | KV 不可用 |

## 4. 路径规范

- 前缀 `/api/{module}/{resource}`，实际落地用 GET + POST（EdgeOne Functions 环境简化）
- 管理端专用接口前缀 `/api/admin/...`；教务 `/api/edu/...`；学工 `/api/af/...`
- 写操作审计：管理端写操作 + 成绩录入/审批/工单处理/公告发布全部落 `sys_op_log`（guard.js opLog）

## 5. 接口清单（截至 2026-09-18，与代码同步）

### 5.1 认证（公开 / 需登录）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | /api/auth/register | 公开 | 学生自助注册（默认 student 角色，IP 频控 5 次/时） |
| POST | /api/auth/login | 公开 | 登录，返回双令牌 + user{roles} |
| POST | /api/auth/refresh | 公开 | 刷新令牌轮换（重放检测） |
| POST | /api/auth/logout | 登录 | 吊销刷新令牌 |
| GET | /api/auth/me | 登录 | 当前用户（含 user_no / dept / class + 数据库实时角色） |
| GET | /api/health | 公开 | 健康检查（db / jwtConfigured / protocol 诊断位） |

### 5.2 管理端基础（阶段 1 基础部分）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/admin/meta | admin / counselor | 角色列表 + 院系列表 + 班级列表 + 当前数据范围 |
| GET | /api/admin/users | admin / counselor | 分页用户列表，支持 keyword / role / deptId / status 过滤（counselor 仅本院） |
| POST | /api/admin/users | admin / counselor | `{userId, action, value}`；action=`setStatus`(改启停) / `setRoles`(仅 admin) / `setProfile`(学号工号+院系班级) |
| GET | /api/admin/departments | admin / counselor | 院系列表（含用户数/班级数） |
| POST | /api/admin/departments | admin | `{action: create \| setStatus}` |

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
| POST | /api/edu/course | student | `{action:'enroll'\|'drop', classId}`；事务+条件 UPDATE 防超卖，唯一键防重选 |
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


## 6. 未实现模块端点（规划，实现后在此补充）

### library（图书，M3）
- `GET /api/library/books?keyword=` 检索；`POST /api/library/borrow` 借书；`POST /api/library/return/:recordId` 还书；`GET /api/library/my` 我的借阅

### market / lost / club（M3）
- 各模块标准 CRUD，开发时在此补充

### dashboard（M4 驾驶舱）
- `GET /api/admin/dashboard` 聚合统计（leader 只读，scope=all）

<!-- TODO: 每完成一个模块，把实际实现的端点补充到这里 -->
