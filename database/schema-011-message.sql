-- ============================================================
-- 智汇校园 · 业务脚本 011：站内信 / 站内通知
--   用户间私信（admin/teacher/counselor 发）+ 系统事件通知（审批结果等自动推送）
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 设计要点:
--   * sender_id = 0 表示系统通知；type 区分 user 私信 / system 事件
--   * biz 字段标记来源业务（leave/club/repair/notice/manual），前端可跳转对应模块
--   * 已读 = read_at 置时间；未读数走 (receiver_id, read_at) 索引 COUNT
--   * 单表不分库：每个接收者一行（广播=批量插入），量级校内场景完全够用
-- ============================================================

CREATE TABLE IF NOT EXISTS sys_message (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sender_id   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '发送人（0=系统）',
  receiver_id BIGINT UNSIGNED NOT NULL COMMENT '接收人',
  type        VARCHAR(8)  NOT NULL DEFAULT 'system' COMMENT 'user=用户私信 system=系统通知',
  biz         VARCHAR(24) NOT NULL DEFAULT '' COMMENT '来源业务 leave/club/repair/notice/manual',
  title       VARCHAR(128) NOT NULL,
  content     VARCHAR(1024) NOT NULL DEFAULT '',
  read_at     DATETIME    NULL COMMENT 'NULL=未读',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_receiver (receiver_id, read_at, created_at),
  KEY idx_sender (sender_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '站内信/站内通知';
