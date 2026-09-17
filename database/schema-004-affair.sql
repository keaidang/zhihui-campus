-- ============================================================
-- 智汇校园 · 业务脚本 004：学工线（通用审批流 + 请销假 + 报修 + 公告）
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 设计要点:
--   * flow_instance / flow_node 两表通用驱动审批流（M2 先服务请销假，
--     后续奖助/调宿等审批复用同一套，毕设论文可作"流程引擎"亮点）
--   * 请假闭环: 申请 -> 辅导员审批 -> (通过) -> 销假; 驳回即终止
-- ============================================================

-- 1. 流程实例（谁发起的什么业务，走到哪一步）
CREATE TABLE IF NOT EXISTS flow_instance (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  biz_type     VARCHAR(32)  NOT NULL COMMENT '业务类型: leave/award/repair...',
  biz_id       BIGINT UNSIGNED NOT NULL COMMENT '业务单据 id',
  title        VARCHAR(128) NOT NULL DEFAULT '' COMMENT '流程标题',
  applicant_id BIGINT UNSIGNED NOT NULL COMMENT '申请人',
  dept_id      BIGINT UNSIGNED NULL COMMENT '申请人院系（辅导员定位审批人用）',
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '1进行中 2通过 3驳回 4已销假',
  current_node TINYINT      NOT NULL DEFAULT 1 COMMENT '当前节点序号',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_applicant (applicant_id),
  KEY idx_dept_status (dept_id, status),
  KEY idx_biz (biz_type, biz_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '审批流程实例表';

-- 2. 流程节点（每个节点一个处理角色 + 处理留痕）
CREATE TABLE IF NOT EXISTS flow_node (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  instance_id BIGINT UNSIGNED NOT NULL COMMENT '流程实例',
  node_order  TINYINT      NOT NULL COMMENT '节点序号 1,2,3...',
  node_name   VARCHAR(64)  NOT NULL COMMENT '节点名称 如 辅导员审批',
  handler_role VARCHAR(32) NOT NULL COMMENT '处理角色 code（实时匹配该角色的人）',
  handler_id  BIGINT UNSIGNED NULL COMMENT '实际处理人',
  status      TINYINT      NOT NULL DEFAULT 0 COMMENT '0待处理 1通过 2驳回',
  opinion     VARCHAR(256) NOT NULL DEFAULT '' COMMENT '审批意见',
  handled_at  DATETIME     NULL COMMENT '处理时间',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_instance_node (instance_id, node_order),
  KEY idx_handler (handler_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '审批流程节点表';

-- 3. 请假单（学工线主单据）
CREATE TABLE IF NOT EXISTS af_leave (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL COMMENT '请假学生',
  dept_id    BIGINT UNSIGNED NULL COMMENT '学生院系',
  type       VARCHAR(16)  NOT NULL DEFAULT '事假' COMMENT '事假/病假/其他',
  reason     VARCHAR(512) NOT NULL COMMENT '请假事由',
  start_at   DATETIME     NOT NULL COMMENT '开始时间',
  end_at     DATETIME     NOT NULL COMMENT '结束时间',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1审批中 2已批准 3已驳回 4已销假',
  back_at    DATETIME     NULL COMMENT '销假时间',
  instance_id BIGINT UNSIGNED NULL COMMENT '关联流程实例',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_student (student_id),
  KEY idx_dept_status (dept_id, status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '请假单';

-- 4. 报修工单
CREATE TABLE IF NOT EXISTS af_repair (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL COMMENT '报修人',
  location    VARCHAR(128) NOT NULL COMMENT '位置 如 6栋 312 宿舍',
  category    VARCHAR(32)  NOT NULL DEFAULT '其他' COMMENT '水电/家具/网络/门锁/其他',
  description VARCHAR(512) NOT NULL COMMENT '故障描述',
  contact     VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '联系电话',
  status      TINYINT      NOT NULL DEFAULT 0 COMMENT '0待受理 1处理中 2已完成',
  handler_id  BIGINT UNSIGNED NULL COMMENT '受理人（辅导员/后勤）',
  remark      VARCHAR(256) NOT NULL DEFAULT '' COMMENT '处理备注',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  KEY idx_status (status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '报修工单';

-- 5. 公告（全校/院系两级）
CREATE TABLE IF NOT EXISTS af_notice (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(128) NOT NULL COMMENT '标题',
  content      TEXT         NOT NULL COMMENT '正文',
  publisher_id BIGINT UNSIGNED NOT NULL COMMENT '发布人',
  dept_id      BIGINT UNSIGNED NULL COMMENT 'NULL=全校公告，否则定向院系',
  pinned       TINYINT      NOT NULL DEFAULT 0 COMMENT '1置顶',
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '1发布 0撤回',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dept_pinned (dept_id, pinned, status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '公告表';

-- 6. 演示公告种子（幂等）
INSERT INTO af_notice (title, content, publisher_id, dept_id, pinned)
SELECT '2026-2027 学年第一学期选课通知', '各位同学：本学期选课已开放，请登录智汇校园平台在"课程选课"模块完成选课。选课期间名额实时变动，先到先得；退改选截止第 2 周周五 17:00。如有疑问请联系本院辅导员。', 1, NULL, 1
 WHERE NOT EXISTS (SELECT 1 FROM af_notice WHERE title LIKE '2026-2027 学年第一学期选课通知%');
INSERT INTO af_notice (title, content, publisher_id, dept_id, pinned)
SELECT '校园冬季消防安全提示', '近期气温下降，宿舍用电负荷增大。严禁使用大功率电器，人走断电；发现消防隐患请通过平台"宿舍报修"或联系宿管中心 8800。', 1, NULL, 0
 WHERE NOT EXISTS (SELECT 1 FROM af_notice WHERE title LIKE '校园冬季消防安全提示%');
