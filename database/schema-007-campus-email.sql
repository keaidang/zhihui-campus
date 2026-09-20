-- schema-007: 校园邮箱与注册验证码
-- 1. 用户表扩展：校园邮箱 + 对外收发开关 + 邮件服务器邮箱ID/密码（管理员可见，用户可改）
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS campus_email   VARCHAR(64)  NULL COMMENT '校园邮箱（系统内地址）';
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS mail_enabled   TINYINT      NOT NULL DEFAULT 0 COMMENT '邮件对外收发：1已开通真实邮箱 0仅系统内';
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS mail_mailbox_id VARCHAR(64)  NULL COMMENT 'LanQin 邮件服务器邮箱ID';
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS mail_password  VARCHAR(64)  NULL COMMENT '邮箱密码（管理员可见可导出，用户可修改）';
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS mail_created_at DATETIME    NULL COMMENT '真实邮箱创建时间';
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS email_verified TINYINT      NOT NULL DEFAULT 0 COMMENT '外部邮箱是否已通过验证码验证';

CREATE UNIQUE INDEX IF NOT EXISTS uk_user_campus_email ON sys_user (campus_email);

-- 2. 注册验证码表（临时数据，过期可清理）
CREATE TABLE IF NOT EXISTS sys_email_code (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(128) NOT NULL COMMENT '收件邮箱（外部邮箱）',
  code       VARCHAR(8)   NOT NULL COMMENT '6位验证码',
  purpose    VARCHAR(16)  NOT NULL DEFAULT 'register' COMMENT '用途：register注册',
  expires_at DATETIME     NOT NULL COMMENT '过期时间（10分钟）',
  used       TINYINT      NOT NULL DEFAULT 0 COMMENT '1已使用',
  attempts   TINYINT      NOT NULL DEFAULT 0 COMMENT '错误尝试次数（≥5作废）',
  ip         VARCHAR(64)  DEFAULT '' COMMENT '请求IP',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_email_purpose (email, purpose, created_at),
  KEY idx_created (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '邮箱验证码';
