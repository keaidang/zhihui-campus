# DATABASE · 数据库设计（单一事实来源）

> 目标库：TiDB Cloud Serverless（MySQL 8.0 兼容语法）。**任何表结构变更必须先改本文档，再改代码。**
> **实际建表以 `database/schema-001~004-*.sql` 为准**（幂等可重复执行，`scripts/migrate.mjs` 跑批）；本文第 3 节起为未实现模块的规划草案。

## 1. 命名与通用规范

- 表名：`snake_case`，按模块加前缀：`sys_`（系统/权限/组织）、`edu_`（教务）、`flow_`（审批流）、`af_`（学工事务）、`lib_`（图书）、`dorm_`（宿舍）、`club_`（社团）、`mkt_`（二手）、`lost_`（失物）
- ~~点餐 meal_~~ 已砍（涉及支付，2026-09-17 决策）
- 主键：`id BIGINT UNSIGNED AUTO_INCREMENT`
- 通用字段：`created_at DATETIME`，需要时加 `updated_at`；状态用 `TINYINT`（含义注释写清楚）
- 字符集 `utf8mb4`

## 2. 已实现表清单（截至 2026-09-18）

### sys 系统与权限（schema-001 + schema-002）
| 表 | 说明 | 关键点 |
|---|---|---|
| sys_user | 统一用户表 | username, password_hash, real_name, email, phone, status；**扩展 user_no(学号/工号), dept_id, class_id**（数据范围判定依据） |
| sys_role | 角色表 | 五角色种子：student/teacher/counselor/leader/admin |
| sys_user_role | 用户-角色关联 | 一个用户可多角色 |
| sys_refresh_token | 刷新令牌 | SHA-256 哈希落库 + 轮换 + 重放全吊销 |
| sys_login_log | 登录审计 | IP/UA/成败 |
| sys_department | 院系 | 6 院系种子（清北大学） |
| sys_class | 班级 | dept_id, grade；3 个班种子 |
| sys_op_log | 管理操作审计 | operator_id, action, target, detail, ip；**500 错误也落这里（action='error.500'）** |

### edu 教务（schema-003，M1）
| 表 | 说明 | 关键点 |
|---|---|---|
| edu_course | 课程主表 | code(唯一), name, credit, hours, dept_id；6 门种子 |
| edu_class | 教学班（开课） | course_id, teacher_id, term='2026-2027-1', **capacity/enrolled**, week_day, section, classroom；3 个种子班绑 teacher01 |
| edu_elect | 选课与成绩（成绩内嵌） | **UNIQUE(class_id, student_id) 防重选**；status: 1修读中 2已出分 0已退课；score, grade(优/良/中/及格/不及格) |

**防超卖范式（论文核心段落素材）**：事务内① `INSERT IGNORE` 选课记录（唯一键占位，冲突=重复选课）→ ② 条件 `UPDATE edu_class SET enrolled=enrolled+1 WHERE id=? AND status=1 AND enrolled<capacity`，affectedRows=0 即名额满 → 回滚。退课反向：置 status=0 + `GREATEST(enrolled-1,0)`。实测并发安全，比草案的 SELECT FOR UPDATE 更简洁。

### flow + af 学工（schema-004，M2）
| 表 | 说明 | 关键点 |
|---|---|---|
| flow_instance | 审批流实例 | biz_type('leave'...), biz_id, applicant_id, dept_id, status(1进行中 2通过 3驳回 4已销假), current_node |
| flow_node | 审批流节点 | instance_id, node_order, handler_role, handler_id, status(0待处理 1通过 2驳回), opinion, handled_at；**UNIQUE(instance_id, node_order)** |
| af_leave | 请假单 | student_id, dept_id, type(事假/病假/其他), reason, start_at/end_at, status(1审批中 2已批准 3已驳回 4已销假), back_at, instance_id |
| af_repair | 报修工单 | user_id, location, category(水电/家具/网络/门锁/其他), description, contact, status(0待受理 1处理中 2已完成), handler_id, remark |
| af_notice | 公告 | title, content, publisher_id, dept_id(NULL=全校), pinned, status(1发布 0撤回) |

**审批流引擎（论文亮点素材）**：flow_instance/flow_node 两表通用驱动，与具体业务解耦。新审批业务只需：建业务单据 + 插 instance + 按 node_order 插节点。请假链路：申请→辅导员审批(实时匹配本院 counselor)→通过/驳回→销假。后续奖助/调宿复用。

## 3. 未实现模块表规划（草案，实现前先按实情修订）

### lib 图书（M3，schema-005）
| 表 | 说明 | 关键字段 |
|---|---|---|
| lib_book | 书目 | isbn, title, author, publisher, category, cover_url |
| lib_book_copy | 馆藏副本 | book_id, copy_no, status(1在馆2借出3预约中4遗失) |
| lib_borrow_record | 借阅记录 | copy_id, user_id, borrowed_at, due_at, returned_at, renew_count |

### dorm 宿舍
| 表 | 说明 | 关键字段 |
|---|---|---|
| dorm_building | 楼栋 | name, gender_limit |
| dorm_room | 房间 | building_id, room_no, capacity, occupied |
| dorm_assignment | 住宿分配 | room_id, user_id, check_in_at, check_out_at |
| dorm_repair_order | 报修工单 | room_id, user_id, description, image_url, status(1提交2受理3完成4评价), handler_id, rating |

### club 社团（M3）
| 表 | 说明 | 关键字段 |
|---|---|---|
| club_info | 社团 | name, category, president_id, member_count, intro |
| club_member | 成员 | club_id, user_id, joined_at, status |
| club_activity | 活动 | club_id, title, location, start_at, capacity |
| club_registration | 活动报名 | activity_id, user_id, **UNIQUE(activity_id, user_id)** |

### mkt 二手交易（M3）
| 表 | 说明 | 关键字段 |
|---|---|---|
| mkt_item | 商品 | seller_id, title, description, price, images(json), status(1在售2已售3下架), category |
| mkt_want | 求购 | user_id, title, description |
| mkt_chat | 留言/联系 | item_id, from_id, to_id, content |

### lost 失物招领（M3）
| 表 | 说明 | 关键字段 |
|---|---|---|
| lost_record | 记录 | type(1失物2招领), user_id, title, description, image_url, location, found_at, status(1待认领2已认领3已关闭), claimer_id |

### fit 健身打卡（可选）
| 表 | 说明 | 关键字段 |
|---|---|---|
| fit_checkin | 打卡记录 | user_id, date, **UNIQUE(user_id, date)** 每天一次 |
| fit_stats | 统计（可选） | user_id, total_days —— 也可由 KV count:fit:{user_id} 承载 |

## 4. KV Key 规范（仅字母/数字/下划线，≤512B）

| Key | 用途 |
|---|---|
| `session_{token}` | 登录态（JSON: userId, role, exp） |
| `config_{name}` | 功能开关/配置 |
| `count_visit_{page}` | 访问计数 |
| `ratelimit_{userId}_{window}` | 接口限流窗口 |

## 5. Blob 目录规范

```
avatar/{userId}/cover.jpg       头像
market/{itemId}/{n}.jpg         二手商品图
lost/{recordId}/{n}.jpg         失物图片
repair/{orderId}/{n}.jpg        报修图片
notice/{noticeId}/{n}.jpg       公告附件
```

## 6. 种子数据

- 当前种子随 schema 脚本幂等写入（角色/院系/班级/课程/教学班/公告），账号用 `scripts/grant-role.mjs` 创建（见 HANDOVER.md 第 2 节）
- 演示数据现状：teacher01 任教 3 班；student01 已选 CS101 且有 92 分成绩（勿清库）
- 后续如需批量种子（书目 100 本等），写 `seed/seed.js` 并在此登记
