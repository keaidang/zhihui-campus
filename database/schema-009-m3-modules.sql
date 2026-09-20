-- ============================================================
-- 智汇校园 · 业务脚本 009：M3 生活服务五模块
--   图书借阅 / 失物招领 / 社团活动 / 校园论坛 / 忘记密码（复用 sys_email_code purpose='reset'）
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 设计要点:
--   * lib_book 预留 ext_source/ext_id 字段对接外部图书馆系统
--   * club_booking 唯一键 (recruit_id,user_id)：预约占位、取消释放、可再预约
--   * forum 图片统一走 sys_blob（LONGBLOB 暂存，后续接图床只换 URL 生成处）
--   * forum_ban 论坛管理员封禁用户（发帖/回复前校验）
-- ============================================================

-- 1. 图书馆藏书
CREATE TABLE IF NOT EXISTS lib_book (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(128) NOT NULL COMMENT '书名',
  author          VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '作者',
  isbn            VARCHAR(20)  NOT NULL DEFAULT '' COMMENT 'ISBN',
  publisher       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '出版社',
  category        VARCHAR(32)  NOT NULL DEFAULT '综合' COMMENT '分类',
  cover_url       VARCHAR(256) NOT NULL DEFAULT '' COMMENT '封面图（可为外链或 /api/blob/xx）',
  location        VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '馆藏位置 如 图书馆3楼A区01架',
  total_copies    INT          NOT NULL DEFAULT 1 COMMENT '馆藏总数',
  available_copies INT         NOT NULL DEFAULT 1 COMMENT '当前可借',
  ext_source      VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '外部对接预留：来源系统标识',
  ext_id          VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '外部对接预留：外部编号',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_title (title),
  KEY idx_category (category),
  KEY idx_isbn (isbn)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '图书馆藏书';

-- 2. 借阅记录
CREATE TABLE IF NOT EXISTS lib_loan (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  book_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  status      TINYINT  NOT NULL DEFAULT 0 COMMENT '0借出中 1已归还 2已逾期(归还时标记过)',
  borrowed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at      DATETIME NOT NULL COMMENT '应还时间（借出+30天）',
  returned_at DATETIME NULL,
  KEY idx_user_status (user_id, status),
  KEY idx_book (book_id),
  KEY idx_due (status, due_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '图书借阅记录';

-- 3. 失物招领
CREATE TABLE IF NOT EXISTS lf_item (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(64)  NOT NULL COMMENT '物品名称',
  description  VARCHAR(512) NOT NULL DEFAULT '' COMMENT '文字描述（拾获地点/特征等）',
  images       TEXT         NOT NULL COMMENT '图片 URL 数组 JSON（/api/blob/xx 或外链）',
  contact      VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '联系电话',
  publisher_id BIGINT UNSIGNED NOT NULL COMMENT '发布人（学工处=counselor/admin）',
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '1有效 0已下架/已认领',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '失物招领';

-- 4. 社团申请（学生提交，教务处=teacher/admin 审批）
CREATE TABLE IF NOT EXISTS club_application (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(64)  NOT NULL COMMENT '社团名称',
  location       VARCHAR(128) NOT NULL DEFAULT '' COMMENT '开课位置',
  content        VARCHAR(512) NOT NULL DEFAULT '' COMMENT '内容简介',
  outline        TEXT         NOT NULL COMMENT '课程/活动大纲',
  activity_time  VARCHAR(128) NOT NULL DEFAULT '' COMMENT '活动时间',
  proposer_id    BIGINT UNSIGNED NOT NULL COMMENT '开课人（申请学生）',
  status         TINYINT      NOT NULL DEFAULT 0 COMMENT '0待审批 1通过 2驳回',
  review_opinion VARCHAR(256) NOT NULL DEFAULT '' COMMENT '审批意见',
  reviewer_id    BIGINT UNSIGNED NULL,
  reviewed_at    DATETIME     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_proposer (proposer_id),
  KEY idx_status (status, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '社团申请';

-- 5. 社团招聘（审批通过后发布；预约占名额）
CREATE TABLE IF NOT EXISTS club_recruit (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id BIGINT UNSIGNED NOT NULL COMMENT '关联的社团申请',
  title          VARCHAR(128) NOT NULL COMMENT '招聘标题',
  content        VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '招聘说明',
  images         TEXT         NOT NULL COMMENT '图片 URL 数组 JSON',
  quota          INT          NOT NULL DEFAULT 0 COMMENT '名额上限（0=不限）',
  taken          INT          NOT NULL DEFAULT 0 COMMENT '已预约人数',
  status         TINYINT      NOT NULL DEFAULT 1 COMMENT '1招募中 0已停止',
  publisher_id   BIGINT UNSIGNED NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status, created_at),
  KEY idx_app (application_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '社团招聘';

-- 6. 社团预约（唯一键：一人一岗位一条记录，取消后可再约）
CREATE TABLE IF NOT EXISTS club_booking (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recruit_id  BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  canceled_at DATETIME NULL COMMENT 'NULL=预约中',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_recruit_user (recruit_id, user_id),
  KEY idx_user (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '社团预约';

-- 7. 论坛板块
CREATE TABLE IF NOT EXISTS forum_board (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(32) NOT NULL COMMENT '板块名',
  description VARCHAR(128) NOT NULL DEFAULT '',
  is_trade    TINYINT     NOT NULL DEFAULT 0 COMMENT '1=交易板块（发帖必填物品/价格/联系方式）',
  sort        INT         NOT NULL DEFAULT 0,
  status      TINYINT     NOT NULL DEFAULT 1,
  UNIQUE KEY uk_name (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '论坛板块';

-- 8. 论坛帖子
CREATE TABLE IF NOT EXISTS forum_thread (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  board_id     BIGINT UNSIGNED NOT NULL,
  author_id    BIGINT UNSIGNED NOT NULL,
  title        VARCHAR(128) NOT NULL,
  content      TEXT         NOT NULL COMMENT '富文本/纯文本',
  images       TEXT         NOT NULL COMMENT '图片 URL 数组 JSON',
  is_trade     TINYINT      NOT NULL DEFAULT 0 COMMENT '1=交易帖',
  item_name    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '交易：物品信息（必填）',
  price        DECIMAL(10,2) NULL COMMENT '交易：价格（必填）',
  contact      VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '交易：联系方式（必填）',
  pinned       TINYINT      NOT NULL DEFAULT 0 COMMENT '论坛管理员置顶',
  locked       TINYINT      NOT NULL DEFAULT 0 COMMENT '锁定（禁止回复）',
  status       TINYINT      NOT NULL DEFAULT 1 COMMENT '1正常 0删除',
  reply_count  INT          NOT NULL DEFAULT 0,
  last_reply_at DATETIME    NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_board (board_id, status, pinned, created_at),
  KEY idx_author (author_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '论坛帖子';

-- 9. 论坛回复
CREATE TABLE IF NOT EXISTS forum_reply (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  thread_id  BIGINT UNSIGNED NOT NULL,
  author_id  BIGINT UNSIGNED NOT NULL,
  content    VARCHAR(1024) NOT NULL,
  status     TINYINT  NOT NULL DEFAULT 1 COMMENT '1正常 0删除',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_thread (thread_id, status, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '论坛回复';

-- 10. 论坛封禁（论坛管理员=admin 可封禁用户发帖/回复）
CREATE TABLE IF NOT EXISTS forum_ban (
  user_id   BIGINT UNSIGNED PRIMARY KEY,
  reason    VARCHAR(128) NOT NULL DEFAULT '',
  banned_by BIGINT UNSIGNED NOT NULL,
  banned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '论坛封禁用户';

-- 11. 图片 Blob 暂存（token 随机 16 位，未登录不可猜测；后续接图床只换生成 URL 处）
CREATE TABLE IF NOT EXISTS sys_blob (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token       CHAR(16)     NOT NULL COMMENT '外链令牌 /api/blob/<token>',
  mime        VARCHAR(64)  NOT NULL DEFAULT 'image/jpeg',
  size        INT          NOT NULL DEFAULT 0,
  data        LONGBLOB     NOT NULL,
  uploader_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_token (token)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '图片 Blob 暂存';

-- 12. 论坛板块种子（幂等）
INSERT INTO forum_board (name, description, is_trade, sort)
SELECT '日常闲谈', '校园生活、闲聊灌水', 0, 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM forum_board WHERE name = '日常闲谈');
INSERT INTO forum_board (name, description, is_trade, sort)
SELECT '计算机', '编程、考研、竞赛、硬件', 0, 2 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM forum_board WHERE name = '计算机');
INSERT INTO forum_board (name, description, is_trade, sort)
SELECT 'AI 前沿', '大模型、论文、AI 应用分享', 0, 3 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM forum_board WHERE name = 'AI 前沿');
INSERT INTO forum_board (name, description, is_trade, sort)
SELECT '金融财经', '行情、理财、行业观察', 0, 4 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM forum_board WHERE name = '金融财经');
INSERT INTO forum_board (name, description, is_trade, sort)
SELECT '学习资料', '课程笔记、真题、经验分享', 0, 5 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM forum_board WHERE name = '学习资料');
INSERT INTO forum_board (name, description, is_trade, sort)
SELECT '交易集市', '二手物品交易（物品/价格/联系方式必填）', 1, 6 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM forum_board WHERE name = '交易集市');
