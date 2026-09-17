-- ============================================================
-- 智汇校园 · 基础架构脚本 002：五角色 + 组织架构（院系/班级）
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 前置: schema-001-auth.sql
-- ============================================================

-- 1. 角色种子：五角色 RBAC（市面通行拆法，2026-09-17 已确认）
INSERT IGNORE INTO sys_role (code, name, description) VALUES
  ('student',   '学生',     '学生服务使用者：选课、请假、报修、社团等'),
  ('teacher',   '教师',     '教学执行者：开课、成绩录入、公告发布'),
  ('counselor', '辅导员',   '院系学生事务管理者：审批、本院数据'),
  ('leader',    '校领导',   '全局数据只读决策者：驾驶舱、统计报表'),
  ('admin',     '管理员',   '系统超级管理员：用户/角色/权限独占');

-- 2. 院系（组织架构第一层）
CREATE TABLE IF NOT EXISTS sys_department (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(32) NOT NULL COMMENT '院系编码',
  name       VARCHAR(64) NOT NULL COMMENT '院系名称',
  sort       INT         NOT NULL DEFAULT 0 COMMENT '排序',
  status     TINYINT     NOT NULL DEFAULT 1 COMMENT '1正常 0停用',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_dept_code (code)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '院系表';

-- 3. 班级（组织架构第二层，用于学生归属）
CREATE TABLE IF NOT EXISTS sys_class (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  dept_id    BIGINT UNSIGNED NOT NULL COMMENT '所属院系',
  name       VARCHAR(64) NOT NULL COMMENT '班级名称',
  grade      SMALLINT    NOT NULL DEFAULT 0 COMMENT '年级（如 2026）',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dept (dept_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '班级表';

-- 4. 用户表扩展：学号/工号 + 归属院系/班级（数据范围 scope 的依据）
--    TiDB 支持 ADD COLUMN IF NOT EXISTS；已存在则跳过
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS user_no  VARCHAR(32)     NOT NULL DEFAULT '' COMMENT '学号/工号';
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS dept_id  BIGINT UNSIGNED NULL COMMENT '归属院系';
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS class_id BIGINT UNSIGNED NULL COMMENT '归属班级';
ALTER TABLE sys_user ADD INDEX IF NOT EXISTS idx_dept (dept_id);

-- 5. 院系种子数据（虚拟学校"清北大学"）
INSERT IGNORE INTO sys_department (code, name, sort) VALUES
  ('CS',  '计算机科学与技术学院', 1),
  ('SE',  '软件工程学院',         2),
  ('EE',  '电子信息工程学院',     3),
  ('EM',  '经济管理学院',         4),
  ('FL',  '外国语学院',           5),
  ('ME',  '机械工程学院',         6);

-- 6. 班级种子数据（示例：计算机学院 2026 级）
INSERT INTO sys_class (dept_id, name, grade)
SELECT d.id, '计算机 2601 班', 2026 FROM sys_department d WHERE d.code = 'CS'
  AND NOT EXISTS (SELECT 1 FROM sys_class c WHERE c.name = '计算机 2601 班');
INSERT INTO sys_class (dept_id, name, grade)
SELECT d.id, '计算机 2602 班', 2026 FROM sys_department d WHERE d.code = 'CS'
  AND NOT EXISTS (SELECT 1 FROM sys_class c WHERE c.name = '计算机 2602 班');
INSERT INTO sys_class (dept_id, name, grade)
SELECT d.id, '软件工程 2601 班', 2026 FROM sys_department d WHERE d.code = 'SE'
  AND NOT EXISTS (SELECT 1 FROM sys_class c WHERE c.name = '软件工程 2601 班');
