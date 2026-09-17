-- ============================================================
-- 智汇校园 · 业务脚本 003：教务线（课程 / 教学班 / 选课与成绩）
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 设计要点:
--   * 防超卖: 名额扣减走条件 UPDATE (enrolled < capacity)
--   * 防重选: edu_elect 唯一键 (class_id, student_id)
--   * 成绩内嵌选课表 (毕设规模不加独立成绩表, 状态机: enrolled -> graded)
-- ============================================================

-- 1. 课程主表（学校课程库）
CREATE TABLE IF NOT EXISTS edu_course (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(32)  NOT NULL COMMENT '课程编码',
  name       VARCHAR(128) NOT NULL COMMENT '课程名称',
  credit     DECIMAL(3,1) NOT NULL DEFAULT 2.0 COMMENT '学分',
  hours      SMALLINT     NOT NULL DEFAULT 32 COMMENT '学时',
  dept_id    BIGINT UNSIGNED NULL COMMENT '开课院系',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1开设 0停开',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_course_code (code),
  KEY idx_dept (dept_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '课程表';

-- 2. 教学班（教师开课：一门课程可开多个班，选课容量/时间/地点在班上）
CREATE TABLE IF NOT EXISTS edu_class (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  course_id  BIGINT UNSIGNED NOT NULL COMMENT '课程',
  teacher_id BIGINT UNSIGNED NOT NULL COMMENT '任课教师 sys_user.id',
  term       VARCHAR(16)  NOT NULL COMMENT '学期 如 2026-2027-1',
  capacity   INT          NOT NULL DEFAULT 60 COMMENT '容量',
  enrolled   INT          NOT NULL DEFAULT 0 COMMENT '已选人数',
  week_day   TINYINT      NOT NULL DEFAULT 1 COMMENT '周几 1-7',
  section    VARCHAR(16)  NOT NULL DEFAULT '1-2节' COMMENT '节次',
  classroom  VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '教室',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1开放选课 0停选',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_teacher (teacher_id),
  KEY idx_term (term),
  CONSTRAINT fk_class_course FOREIGN KEY (course_id) REFERENCES edu_course (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '教学班（开课）表';

-- 3. 选课记录（含成绩；条件 UPDATE + 唯一键双保险）
CREATE TABLE IF NOT EXISTS edu_elect (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id   BIGINT UNSIGNED NOT NULL COMMENT '教学班',
  student_id BIGINT UNSIGNED NOT NULL COMMENT '学生 sys_user.id',
  term       VARCHAR(16)  NOT NULL COMMENT '学期（冗余，便于按学期查课表/成绩）',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1修读中 2已出分 0已退课',
  score      DECIMAL(5,1) NULL COMMENT '百分制成绩',
  grade      VARCHAR(8)   NULL COMMENT '五级制 优/良/中/及格/不及格',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_class_student (class_id, student_id),
  KEY idx_student (student_id, term)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '选课与成绩表';

-- 4. 课程种子数据（虚拟学校"清北大学"，幂等）
INSERT INTO edu_course (code, name, credit, hours, dept_id)
SELECT 'CS101', '数据结构与算法', 4.0, 64, d.id FROM sys_department d WHERE d.code='CS'
  AND NOT EXISTS (SELECT 1 FROM edu_course WHERE code='CS101');
INSERT INTO edu_course (code, name, credit, hours, dept_id)
SELECT 'CS204', '操作系统原理', 3.5, 56, d.id FROM sys_department d WHERE d.code='CS'
  AND NOT EXISTS (SELECT 1 FROM edu_course WHERE code='CS204');
INSERT INTO edu_course (code, name, credit, hours, dept_id)
SELECT 'CS305', '软件工程导论', 3.0, 48, d.id FROM sys_department d WHERE d.code='CS'
  AND NOT EXISTS (SELECT 1 FROM edu_course WHERE code='CS305');
INSERT INTO edu_course (code, name, credit, hours, dept_id)
SELECT 'GE001', '高等数学（下）', 5.0, 80, d.id FROM sys_department d WHERE d.code='EM'
  AND NOT EXISTS (SELECT 1 FROM edu_course WHERE code='GE001');
INSERT INTO edu_course (code, name, credit, hours, dept_id)
SELECT 'GE002', '大学英语（四）', 2.0, 32, d.id FROM sys_department d WHERE d.code='FL'
  AND NOT EXISTS (SELECT 1 FROM edu_course WHERE code='GE002');
INSERT INTO edu_course (code, name, credit, hours, dept_id)
SELECT 'PE001', '阳光体育与体能训练', 1.0, 32, d.id FROM sys_department d WHERE d.code='ME'
  AND NOT EXISTS (SELECT 1 FROM edu_course WHERE code='PE001');

-- 5. 教学班种子数据：绑定 teacher01（账号先由 grant-role.mjs 创建，不存在则跳过）
INSERT INTO edu_class (course_id, teacher_id, term, capacity, enrolled, week_day, section, classroom)
SELECT c.id, u.id, '2026-2027-1', 50, 0, 1, '1-2节', '教学楼 A101'
  FROM edu_course c JOIN sys_user u ON u.username = 'teacher01'
 WHERE c.code = 'CS101'
   AND NOT EXISTS (SELECT 1 FROM edu_class e WHERE e.course_id = c.id AND e.teacher_id = u.id);
INSERT INTO edu_class (course_id, teacher_id, term, capacity, enrolled, week_day, section, classroom)
SELECT c.id, u.id, '2026-2027-1', 45, 0, 3, '3-4节', '教学楼 B203'
  FROM edu_course c JOIN sys_user u ON u.username = 'teacher01'
 WHERE c.code = 'CS204'
   AND NOT EXISTS (SELECT 1 FROM edu_class e WHERE e.course_id = c.id AND e.teacher_id = u.id);
INSERT INTO edu_class (course_id, teacher_id, term, capacity, enrolled, week_day, section, classroom)
SELECT c.id, u.id, '2026-2027-1', 60, 0, 2, '5-6节', '实验楼 C305'
  FROM edu_course c JOIN sys_user u ON u.username = 'teacher01'
 WHERE c.code = 'CS305'
   AND NOT EXISTS (SELECT 1 FROM edu_class e WHERE e.course_id = c.id AND e.teacher_id = u.id);
