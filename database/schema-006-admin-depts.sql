-- schema-006: 行政部门支持
-- 1. 院系表增加类型：college=教学院系（可开课、带班级）；admin=行政部门（职能部门）
ALTER TABLE sys_department ADD COLUMN IF NOT EXISTS dept_type VARCHAR(16) NOT NULL DEFAULT 'college' COMMENT '类型：college教学院系 admin行政部门';

-- 2. 行政部门（虚拟学校"清北大学"职能部门）
INSERT INTO sys_department (code, name, sort, status, dept_type) VALUES
  ('XZS',  '校长室',       90, 1, 'admin'),
  ('DW',   '党委办公室',   91, 1, 'admin'),
  ('JWC',  '教务处',       92, 1, 'admin'),
  ('XGC',  '学生工作处',   93, 1, 'admin'),
  ('TW',   '校团委',       94, 1, 'admin'),
  ('RSC',  '人事处',       95, 1, 'admin'),
  ('CWC',  '财务处',       96, 1, 'admin'),
  ('ZJC',  '招生就业处',   97, 1, 'admin'),
  ('HQC',  '后勤保障处',   98, 1, 'admin'),
  ('TSG',  '图书馆',       99, 1, 'admin')
ON DUPLICATE KEY UPDATE name = VALUES(name), dept_type = 'admin';
