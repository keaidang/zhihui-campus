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
| 40101 | 用户名或密码错误 |
| 40300 | 无权限 / 账号被禁用 |
| 40400 | 资源不存在 |
| 41001 | 参数错误 |
| 41002 | 用户名已被注册 |
| 42900 | 登录失败次数过多（限流锁定 10 分钟） |
| 42001 | 选课时间冲突 |
| 42002 | 课程名额已满 |
| 42003 | 重复选课 |
| 50000 | 服务器内部错误 |
| 50001 | KV 不可用 |

## 4. 路径规范

- 前缀 `/api/{module}/{resource}`，RESTful 动词：GET 查 / POST 增 / PUT 改 / DELETE 删
- 管理端专用接口前缀 `/api/admin/...`（需对应角色）

## 5. 接口清单（截至 2026-09-17）

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


## 5. 模块端点清单（随开发更新）

### auth（已实现，v0.1）
- `POST /api/auth/register` 注册（username/password/realName，默认授予 student 角色）→ { id, username, realName }
- `POST /api/auth/login` 登录 → { accessToken, refreshToken, expiresIn, user:{id,username,realName,roles[]} }
- `POST /api/auth/refresh` 刷新访问令牌（body: refreshToken；轮换+重放检测）→ 同 login 返回结构
- `POST /api/auth/logout` 退出（吊销 refreshToken）
- `GET  /api/auth/me` 当前用户信息（Bearer）→ { id, username, realName, email, phone, roles[] }
- `GET  /api/health` 健康检查（含数据库连通性，公开）
- `GET  /api/kv-check` KV 连通性验证（Edge Functions，公开，验收用）

**认证安全设计**：bcrypt(10) 密码哈希；JWT HS256 访问令牌 2h；刷新令牌 48 字节随机、库内存 SHA-256 哈希、7 天有效、每次刷新轮换，检测到重放立即吊销该用户全部会话；登录失败 5 次锁定 10 分钟（实例级）；登录行为写入 sys_login_log 审计。

### course（选课）
- `GET  /api/course/list?term=&page=` 课程列表
- `GET  /api/course/timetable` 我的课表
- `POST /api/course/select` 选课（body: courseId）
- `DELETE /api/course/select/:courseId` 退课

### library（图书）
- `GET  /api/library/books?keyword=` 检索
- `POST /api/library/borrow` 借书（copyId）
- `POST /api/library/return/:recordId` 还书
- `GET  /api/library/my` 我的借阅

### dorm（宿舍）
- `POST /api/dorm/repair` 提交报修（含 Blob 图片）
- `GET  /api/dorm/repair/my` 我的工单
- `PUT  /api/admin/dorm/repair/:id/status` 工单流转

### meal / market / lost / club / fitness
- 各模块标准 CRUD，开发时在下方补充

<!-- TODO: 每完成一个模块，把实际实现的端点补充到这里 -->
