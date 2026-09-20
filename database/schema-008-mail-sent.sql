-- schema-008: 已发邮件记录（"已发送"页签数据源；LanQin 的 GET /send 列表接口不稳定，改为本地记录）
CREATE TABLE IF NOT EXISTS sys_mail_sent (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  mailbox_id   VARCHAR(64)  NOT NULL COMMENT 'LanQin mailboxId',
  mail_id      VARCHAR(64)  DEFAULT NULL COMMENT 'LanQin 邮件 ID（可查投递状态）',
  to_addr      VARCHAR(320) NOT NULL,
  subject      VARCHAR(255) DEFAULT '',
  snippet      VARCHAR(500) DEFAULT '',
  status       VARCHAR(24)  DEFAULT 'queued' COMMENT 'queued/sending/relayed/delivered/failed/bounced',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id, id),
  KEY idx_mail (mail_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '校园邮箱已发邮件';
