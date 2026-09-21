# DATABASE · 数据库设计（单一事实来源）

> 目标库：TiDB Cloud Serverless（MySQL 8.0 兼容语法）。**任何表结构变更必须先改本文档，再改代码。**
> **实际建表以 `database/schema-001~009-*.sql` 为准**（幂等可重复执行，`scripts/migrate.mjs` 跑批）；本文第 4 节起为未实现模块的规划草案。

## 1. 命名与通用规范

- 表名：`snake_case`，按模块加前缀：`sys_`（系统/权限/组织/邮箱/附件）、`edu_`（教务）、`flow_`（审批流）、`af_`（学工事务）、`lib_`（图书）、`lf_`（失物招领）、`club_`（社团）、`forum_`（论坛）
- ~~点餐 meal_~~ 已砍（涉及支付，2026-09-17 决策）；~~mkt_ 二手~~ 已改为论坛 forum_（2026-09-20 决策）
- 主键：`id BIGINT UNSIGNED AUTO_INCREMENT`
- 通用字段：`created_at DATETIME`，需要时加 `updated_at`；状态用 `TINYINT`（含义注释写清楚）
- 字符集 `utf8mb4`

## 2. 已实现表清单（截至 2026-09-20）

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

**防超卖范式（论文核心段落素材）**：事务内① `INSERT ... ON DUPLICATE KEY UPDATE status = IF(status = 2, status, 1)` 选课记录（唯一键占位；冲突时已退课 status=0 → 重激活为 1，已选/已出分 status=1/2 → 无变化，affectedRows=0 即重复选课）→ ② 条件 `UPDATE edu_class SET enrolled=enrolled+1 WHERE id=? AND status=1 AND enrolled<capacity`，affectedRows=0 即名额满 → 回滚。退课反向：置 status=0 + `GREATEST(enrolled-1,0)`。**退课后可再次选课**（重激活原记录，成绩内嵌表不物理删行）。实测并发安全，比草案的 SELECT FOR UPDATE 更简洁。

### flow + af 学工（schema-004，M2）
| 表 | 说明 | 关键点 |
|---|---|---|
| flow_instance | 审批流实例 | biz_type('leave'...), biz_id, applicant_id, dept_id, status(1进行中 2通过 3驳回 4已销假), current_node |
| flow_node | 审批流节点 | instance_id, node_order, handler_role, handler_id, status(0待处理 1通过 2驳回), opinion, handled_at；**UNIQUE(instance_id, node_order)** |
| af_leave | 请假单 | student_id, dept_id, type(事假/病假/其他), reason, start_at/end_at, status(1审批中 2已批准 3已驳回 4已销假), back_at, instance_id |
| af_repair | 报修工单（**单节点状态机，无 instance_id**） | user_id, location, category(水电/家具/网络/门锁/其他), description, contact, status(0待受理 1处理中 2已完成 3无法处理), handler_id, remark(处理备注 / 无法处理原因) |
| af_notice | 公告 | title, content, publisher_id, dept_id(NULL=全校), pinned, status(1发布 0撤回) |

**审批流引擎（论文亮点素材）**：flow_instance/flow_node 两表驱动，与具体业务解耦——业务表只维护自身状态，另插一条 instance 以 `(biz_type, biz_id)` 关联；节点按 `node_order` 逐个流转，处理人由 `handler_role` **实时匹配**（不写死具体人）。新审批业务只需：建业务单据 + 插 instance + 按 node_order 插节点。请假链路：申请→辅导员审批(实时匹配本院 counselor)→通过/驳回→销假。

### 审批流 vs 状态机（★ 新业务先做这个判断，再动手）

**实际接入范围（如实口径）**：审批流引擎**当前仅请销假在用**（`flow_instance` 里 `biz_type` 只有 `'leave'`）。

| 判据 | 用审批流引擎（flow_instance/flow_node） | 用单节点状态机（业务表自带 status） |
|---|---|---|
| 处理环节 | 多节点、逐级流转 | **单节点**——一个人受理即闭环 |
| 业务语义 | 批准 / 驳回（对"申请"的表态） | 受理 / 完成（对"工单"的派办） |
| 留痕需求 | 需要每节点的意见、处理人、时间 | 单据自身的 `handler_id` / `remark` 已足够 |
| 现有实例 | **请销假**（af_leave） | **报修**（af_repair）、社团申请（club_application） |

报修与社团申请都是自建状态机——这是**有意的设计取舍**（为单节点业务引入两表流程反而增加无收益的耦合），不是漏接。⚠ 历史文档曾表述为"请假/奖助/报修共用一套流转逻辑"，与实现不符，已于 2026-09-21 更正。

### 组织升级（schema-005/006）
| 变更 | 说明 |
|---|---|
| sys_user.valid_until | 账号有效期（NULL=长期；过期登录/刷新被拒） |
| sys_class.counselor_id | 班级绑定辅导员（学生管理数据范围依据）；各学院班级补齐 |
| sys_department.dept_type | college=教学院系 / admin=行政部门（10 个行政部门种子） |

### 校园邮箱（schema-007/008）
| 表/字段 | 说明 |
|---|---|
| sys_user.campus_email / mail_enabled / mail_mailbox_id / mail_password / mail_created_at / email_verified | 校园邮箱地址 + 对外收发开通态（LanQin 邮箱 ID/密码） |
| sys_email_code | 邮箱验证码：purpose('register'/'reset')，SQL 侧 `expires_at > NOW()` 判过期，尝试次数限制 |
| sys_mail_sent | 本地发件台账（LanQin GET /send 列表接口超时弃用后自建；状态回查 60s 节流） |

### M3 生活服务（schema-009，2026-09-20）
| 表 | 说明 | 关键点 |
|---|---|---|
| lib_book | 藏书 | isbn/title/author/publisher/category/cover_url/location，total_copies/available_copies；**ext_source/ext_id 预留外部图书馆对接** |
| lib_loan | 借阅记录 | book_id, user_id, borrowed_at, **due_at(借期 30 天)**, returned_at, status(1在借 2已还 2含逾期标记) |
| lf_item | 失物招领 | user_id(发布人), title, description, images(json), contact, location, status(1待认领 2已认领) |
| club_application | 社团申请 | **name, location(开课位置), content, outline(大纲), activity_time(活动时间)**, proposer_id(开课人), status(0待审 1通过 2驳回) |
| club_recruit | 招聘发布 | application_id, title/content/images/quota/taken, publisher_id, status(1招募中)——**无 location/activity_time，取这两字段要 join club_application** |
| club_booking | 预约占位 | **UNIQUE(recruit_id, user_id)**，canceled_at NULL=预约中；取消释放名额后可再预约（重激活原记录） |
| forum_board | 板块 | 6 板块种子（日常闲谈/计算机/AI 前沿/金融财经/学习资料/交易集市），**is_trade=1 交易板块** |
| forum_thread | 帖子 | board_id, author_id, title, content, images；**item_name/price/contact 交易必填**；pinned/locked/status |
| forum_reply | 回复 | thread_id, author_id, content, floor |
| forum_ban | 禁言 | user_id, until_at, reason（发帖/回复前校验） |
| sys_blob | 图片暂存 | **token CHAR(16) 唯一**，mime, size, content LONGBLOB；访问走 `/api/blob?token=`（EdgeOne 函数不支持路径参数） |

### 宿舍管理（schema-010，2026-09-20）
| 表/字段 | 说明 | 关键点 |
|---|---|---|
| sys_user.gender | 性别 0未知 1男 2女 | 宿舍分配约束依据；种子按 user_id 奇偶确定性铺齐（男 201/女 202） |
| dorm_building | 楼栋 | name 唯一，**gender 楼栋性别属性**（male/female），floors；8 栋种子（1-4 男寝 5-8 女寝） |
| dorm_room | 房间 | UNIQUE(building_id, room_no)，floor, capacity, **occupied 冗余计数**（与分配同事务维护），status |
| dorm_assignment | 住宿分配 | **生成列 active_flag（在住=1/退宿=NULL）+ UNIQUE(user_id, active_flag)** 实现"一人最多一条在住"的库级约束，退宿留历史可再分配；报修复用 af_repair（M2 表）不另建 |

### 站内信（schema-011，2026-09-20）
| 表 | 说明 | 关键点 |
|---|---|---|
| sys_message | 站内信/通知单表 | sender_id=0 系统通知；**biz 标记来源业务**（leave/club/repair/manual）；read_at NULL=未读；索引(receiver_id, read_at, created_at)；广播=批量插入 |

## 3. 未实现模块表规划（草案，实现前先按实情修订）

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

## 5. Blob 规范

M3 起图片统一存 `sys_blob` 表（LONGBLOB，token CHAR(16)），URL 形如 `/api/blob?token=<16位>`（公共只读，immutable 缓存）；前端统一 `ImgUploader` 组件（canvas 压缩 1280px/JPEG 0.85）。接图床时只换 blob.js 与 ImgUploader 的 URL 生成。旧规划的对象存储目录（avatar/market/lost/…）作废。

## 6. 种子数据

- schema 种子随脚本幂等写入（角色/院系/班级/课程/教学班/公告/行政部门/论坛板块）；账号用 `scripts/grant-role.mjs`，批量演示数据见 HANDOVER.md（seed-demo / seed-admin-staff）
- **M3 测试数据 `node scripts/seed-m3.mjs`（幂等）**：420 本藏书 / 失物 8 条 / 社团 6 通过+2 待审 / 论坛 30+ 帖+回复；图片抓 picsum 失败自动生成 SVG 占位图存 sys_blob
- 社团预约已用 `scripts/fix-club-bookings.mjs` 打散到全体 400 学生（seed 早期版本集中给前排学生，勿重跑旧逻辑）；student004 保留 AI 兴趣社 1 条预约
- **宿舍数据 `node scripts/seed-dorm.mjs`（幂等）**：学生性别确定性补齐（user_id 奇偶）→ 8 栋 × 6 层 × 8 间房（4 人间为主含 6 人间）→ 403 名学生按性别全部入住（集中住满，保留空位供演示分配）
