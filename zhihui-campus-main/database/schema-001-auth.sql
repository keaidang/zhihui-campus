-- ============================================================
-- 智汇校园 · 数据库地基脚本 001：统一用户与认证
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 原则: utf8mb4 / InnoDB / 参数化查询配合 / 软删除暂不启用
-- ============================================================

-- 1. 用户主表（全校统一账号）
CREATE TABLE IF NOT EXISTS sys_user (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL COMMENT '登录名（唯一）',
  password_hash VARCHAR(100) NOT NULL COMMENT 'bcrypt 哈希',
  real_name     VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '真实姓名',
  email         VARCHAR(128) NOT NULL DEFAULT '',
  phone         VARCHAR(20)  NOT NULL DEFAULT '',
  avatar_url    VARCHAR(255) NOT NULL DEFAULT '',
  status        TINYINT      NOT NULL DEFAULT 1 COMMENT '1正常 0禁用',
  last_login_at DATETIME     NULL COMMENT '最近登录时间',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_username (username)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '统一用户表';

-- 2. 角色表（RBAC）
CREATE TABLE IF NOT EXISTS sys_role (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(32) NOT NULL COMMENT '角色编码: admin/teacher/student',
  name        VARCHAR(32) NOT NULL COMMENT '角色显示名',
  description VARCHAR(128) NOT NULL DEFAULT '',
  UNIQUE KEY uk_code (code)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '角色表';

-- 3. 用户-角色关联
CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id INT UNSIGNED    NOT NULL,
  PRIMARY KEY (user_id, role_id),
  KEY idx_role (role_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '用户角色关联表';

-- 4. 刷新令牌表（轮换 + 可吊销，存 SHA-256 哈希不存明文）
CREATE TABLE IF NOT EXISTS sys_refresh_token (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64)    NOT NULL COMMENT 'SHA-256(refreshToken)',
  expires_at DATETIME    NOT NULL,
  revoked    TINYINT     NOT NULL DEFAULT 0 COMMENT '1=已吊销',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_token (token_hash),
  KEY idx_user (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '刷新令牌表';

-- 5. 登录审计表（安全要求：可追溯异常登录）
CREATE TABLE IF NOT EXISTS sys_login_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NULL COMMENT '登录失败时可能无法定位用户',
  username   VARCHAR(32) NOT NULL,
  ip         VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  success    TINYINT     NOT NULL DEFAULT 0,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_time (user_id, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '登录审计日志';

-- 6. 种子数据：三个基础角色 + 默认管理员（首次部署后立即改密）
INSERT IGNORE INTO sys_role (code, name, description) VALUES
  ('admin',   '管理员', '系统全局管理'),
  ('teacher', '教师',   '教学相关业务'),
  ('student', '学生',   '校园生活服务');
