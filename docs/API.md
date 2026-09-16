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
| 40300 | 无权限 |
| 40400 | 资源不存在 |
| 41001 | 参数错误 |
| 42001 | 选课时间冲突 |
| 42002 | 课程名额已满 |
| 42003 | 重复选课 |

## 4. 路径规范

- 前缀 `/api/{module}/{resource}`，RESTful 动词：GET 查 / POST 增 / PUT 改 / DELETE 删
- 管理端专用接口前缀 `/api/admin/...`（需对应角色）

## 5. 模块端点清单（随开发更新）

### auth
- `POST /api/auth/login` 登录 → { token, user }
- `POST /api/auth/logout` 退出（清理 KV session）
- `GET  /api/auth/me` 当前用户信息

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
