-- ============================================================
-- 智汇校园 · 组织与管理升级 005：账号有效期 + 班级-辅导员绑定
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 前置: schema-001~004；幂等可重复执行
-- ============================================================

-- 1. 账号有效期（NULL = 长期有效；过期账号登录/刷新被拒）
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS valid_until DATETIME NULL COMMENT '账号有效期（NULL=长期）';

-- 2. 班级绑定辅导员（学生管理的数据范围依据：辅导员只看自己带的班）
ALTER TABLE sys_class ADD COLUMN IF NOT EXISTS counselor_id BIGINT UNSIGNED NULL COMMENT '辅导员 sys_user.id';
ALTER TABLE sys_class ADD INDEX IF NOT EXISTS idx_counselor (counselor_id);

-- 3. 各学院班级补齐（每个学院至少 1 个班，便于演示与名册管理）
INSERT INTO sys_class (dept_id, name, grade)
SELECT d.id, '电子信息 2601 班', 2026 FROM sys_department d WHERE d.code = 'EE'
  AND NOT EXISTS (SELECT 1 FROM sys_class c WHERE c.name = '电子信息 2601 班');
INSERT INTO sys_class (dept_id, name, grade)
SELECT d.id, '经管 2601 班', 2026 FROM sys_department d WHERE d.code = 'EM'
  AND NOT EXISTS (SELECT 1 FROM sys_class c WHERE c.name = '经管 2601 班');
INSERT INTO sys_class (dept_id, name, grade)
SELECT d.id, '外语 2601 班', 2026 FROM sys_department d WHERE d.code = 'FL'
  AND NOT EXISTS (SELECT 1 FROM sys_class c WHERE c.name = '外语 2601 班');
INSERT INTO sys_class (dept_id, name, grade)
SELECT d.id, '机械 2601 班', 2026 FROM sys_department d WHERE d.code = 'ME'
  AND NOT EXISTS (SELECT 1 FROM sys_class c WHERE c.name = '机械 2601 班');

-- 4. 演示账号归属：学生进班（名册/辅导员数据范围演示数据）
UPDATE sys_user u JOIN sys_class c ON c.name = '计算机 2601 班'
   SET u.class_id = c.id, u.dept_id = c.dept_id
 WHERE u.username = 'student02' AND (u.class_id IS NULL OR u.class_id = 0);
UPDATE sys_user u JOIN sys_class c ON c.name = '计算机 2602 班'
   SET u.class_id = c.id, u.dept_id = c.dept_id
 WHERE u.username = 'student03' AND (u.class_id IS NULL OR u.class_id = 0);
UPDATE sys_user u JOIN sys_department d ON d.code = 'CS'
   SET u.dept_id = d.id
 WHERE u.username IN ('student02', 'student03') AND u.dept_id IS NULL;

-- 5. 辅导员绑定班级：counselor01 带计算机 2601/2602 班
UPDATE sys_class c JOIN sys_user u ON u.username = 'counselor01'
   SET c.counselor_id = u.id
 WHERE c.name IN ('计算机 2601 班', '计算机 2602 班');
