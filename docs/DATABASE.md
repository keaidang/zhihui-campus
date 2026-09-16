# DATABASE · 数据库设计（单一事实来源）

> 目标库：TiDB Cloud Serverless（MySQL 8.0 兼容语法）。**任何表结构变更必须先改本文档，再改代码。**

## 1. 命名与通用规范

- 表名：`snake_case`，按模块加前缀：`sys_`（系统）、`stu_`（学生/选课）、`lib_`（图书）、`dorm_`（宿舍）、`club_`（社团）、`meal_`（点餐）、`mkt_`（二手）、`lost_`（失物）、`fit_`（健身）
- 主键：`id BIGINT AUTO_INCREMENT`
- 通用字段：`created_at DATETIME`、`updated_at DATETIME`、`deleted_at DATETIME NULL`（软删除）
- 金额用 `DECIMAL(10,2)`，状态用 `TINYINT`（含义注释写清楚）
- 字符集 `utf8mb4`

## 2. 表清单（按模块）

### sys 系统与权限
| 表 | 说明 | 关键字段 |
|---|---|---|
| sys_user | 统一用户表 | username, password_hash, real_name, role(TINYINT:1学生2教师3后勤4管理员), phone, avatar_url, status |
| sys_student_profile | 学籍档案 | user_id, student_no, department, major, class_name, grade, enrollment_year |
| sys_role_permission | 角色权限点 | role, perm_code, 说明: RBAC 映射 |
| sys_notice | 公告 | title, content, publisher_id, target_role |

### stu 选课
| 表 | 说明 | 关键字段 |
|---|---|---|
| stu_course | 课程 | code, name, teacher_id, credit, capacity, enrolled(已选人数), week_day, start_section, end_section, term |
| stu_course_selection | 选课记录 | course_id, student_id, term, **UNIQUE(course_id, student_id)** 防重复选 |

### lib 图书
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

### club 社团
| 表 | 说明 | 关键字段 |
|---|---|---|
| club_info | 社团 | name, category, president_id, member_count, intro |
| club_member | 成员 | club_id, user_id, joined_at, status |
| club_activity | 活动 | club_id, title, location, start_at, capacity |
| club_registration | 活动报名 | activity_id, user_id, **UNIQUE(activity_id, user_id)** |

### meal 点餐（模拟支付）
| 表 | 说明 | 关键字段 |
|---|---|---|
| meal_canteen / meal_window | 食堂/档口 | name, location |
| meal_dish | 菜品 | window_id, name, price, image_url, status |
| meal_order | 订单 | order_no, user_id, total, status(1待取餐2已完成3已取消), pickup_code |
| meal_order_item | 订单明细 | order_id, dish_id, qty, price_snapshot |

### mkt 二手交易
| 表 | 说明 | 关键字段 |
|---|---|---|
| mkt_item | 商品 | seller_id, title, description, price, images(json), status(1在售2已售3下架), category |
| mkt_want | 求购 | user_id, title, description |
| mkt_chat | 留言/联系 | item_id, from_id, to_id, content |

### lost 失物招领
| 表 | 说明 | 关键字段 |
|---|---|---|
| lost_record | 记录 | type(1失物2招领), user_id, title, description, image_url, location, found_at, status(1待认领2已认领3已关闭), claimer_id |

### fit 健身打卡
| 表 | 说明 | 关键字段 |
|---|---|---|
| fit_checkin | 打卡记录 | user_id, date, **UNIQUE(user_id, date)** 每天一次 |
| fit_stats | 统计（可选） | user_id, total_days —— 也可由 KV count:fit:{user_id} 承载 |

## 3. 核心表完整 SQL 示例

```sql
CREATE TABLE stu_course (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(20)  NOT NULL COMMENT '课程编号',
  name          VARCHAR(64)  NOT NULL,
  teacher_id    BIGINT       NOT NULL,
  credit        DECIMAL(3,1) NOT NULL DEFAULT 1.0,
  capacity      INT          NOT NULL DEFAULT 0 COMMENT '容量',
  enrolled      INT          NOT NULL DEFAULT 0 COMMENT '已选人数',
  week_day      TINYINT      NOT NULL COMMENT '1-7 星期几',
  start_section TINYINT      NOT NULL COMMENT '起始节次',
  end_section   TINYINT      NOT NULL,
  term          VARCHAR(16)  NOT NULL COMMENT '如 2026-2027-1',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME     NULL,
  KEY idx_term (term),
  KEY idx_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='课程表';

CREATE TABLE stu_course_selection (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  course_id  BIGINT NOT NULL,
  student_id BIGINT NOT NULL,
  term       VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_course_student (course_id, student_id),
  KEY idx_student (student_id, term)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='选课记录';
```

**选课并发方案（论文核心段落素材）**：事务内 `SELECT ... FOR UPDATE` 课程行 → 校验 `enrolled < capacity` 且无时间冲突 → 插入选课记录（唯一键兜底）→ `UPDATE stu_course SET enrolled = enrolled + 1` → 提交。并发脚本压测演示。

## 4. KV Key 规范（仅字母/数字/下划线，≤512B）

| Key | 用途 |
|---|---|
| `session_{token}` | 登录态（JSON: userId, role, exp） |
| `config_{name}` | 功能开关/配置 |
| `count_visit_{page}` | 访问计数 |
| `count_fit_{userId}_{yyyymmdd}` | 打卡连续天数缓存 |
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

`seed/seed.js`：生成 4 角色账号、2 学期课程各 30 门、书目 100 本、楼栋 4 栋、菜品 50 个、二手/失物各 20 条。任何会话跑一遍即可恢复演示环境。
