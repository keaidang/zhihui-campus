-- ============================================================
-- 智汇校园 · 业务脚本 012：AI 能力融合基础表
--   设计依据：docs/AI-FEATURES.md §3（表清单）与 §9（实施计划 P1）
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 设计要点:
--   * sys_config   —— 运行时开关与阈值。环境变量改动需重新部署（铁律 #5），
--                     而"管理员可开关 AI 功能"必须即时生效，故落库（键值表）
--   * ai_kb        —— 校园知识库条目（C1 问答的知识来源）。UNIQUE(category,title)
--                     保证 seed 脚本可幂等重复执行
--   * ai_usage_log —— AI 调用流水。双重用途：① 频控计数（DB 流水，铁律 #23
--                     禁止内存计数）② 论文用的 token/延迟统计
--   * ai_review_log—— 论坛 AI 审核判定留痕 + 人工复核队列（C2）
--   * ai_alert_log —— 告警邮件发送留痕与去重（C3）
--   * 全部为新增表/新增列，不改动任何既有字段语义，向后兼容
-- ============================================================

-- ---------- 1. 运行时配置（键值） ----------
CREATE TABLE IF NOT EXISTS sys_config (
  cfg_key    VARCHAR(64)   NOT NULL PRIMARY KEY COMMENT '配置键，如 ai.chat.enabled',
  cfg_value  VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '配置值（统一存字符串，读取方自行转换）',
  remark     VARCHAR(255)  NOT NULL DEFAULT '' COMMENT '用途说明（管理页展示）',
  updated_by BIGINT UNSIGNED NULL COMMENT '最后修改人 sys_user.id',
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '运行时配置（AI 开关与阈值等）';

-- ---------- 2. 校园知识库（C1 问答知识来源） ----------
CREATE TABLE IF NOT EXISTS ai_kb (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category   VARCHAR(32)  NOT NULL DEFAULT '其他' COMMENT '分类：学校概况/组织架构/教务/学工/宿舍/生活服务/校园邮箱/账号安全/权限角色/常见问题',
  title      VARCHAR(128) NOT NULL COMMENT '条目标题（同分类内唯一，seed 幂等键）',
  keywords   VARCHAR(255) NOT NULL DEFAULT '' COMMENT '检索关键词，逗号分隔（中文无分词器，靠人工标注兜底）',
  content    TEXT         NOT NULL COMMENT '正文（纯文本，不含 HTML）',
  sort       INT          NOT NULL DEFAULT 0 COMMENT '同分类内排序',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 0 停用',
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cat_title (category, title),
  KEY idx_status_sort (status, sort, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'AI 校园知识库条目';

-- ---------- 3. AI 调用流水（频控 + 统计） ----------
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT UNSIGNED NOT NULL,
  kind              VARCHAR(16) NOT NULL DEFAULT 'chat' COMMENT 'chat/action/insight/review/study/alert/other',
  model             VARCHAR(48) NOT NULL DEFAULT '' COMMENT '实际调用的模型名',
  prompt_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  ok                TINYINT NOT NULL DEFAULT 1 COMMENT '1 成功 0 失败/降级',
  cost_ms           INT NOT NULL DEFAULT 0 COMMENT '端到端耗时（毫秒）',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_kind_time (user_id, kind, created_at),
  KEY idx_time (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'AI 调用流水（限流计数与用量统计）';

-- ---------- 4. 论坛 AI 审核留痕与人工复核队列（C2） ----------
CREATE TABLE IF NOT EXISTS ai_review_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  biz        VARCHAR(16) NOT NULL COMMENT 'thread=主题帖 reply=回复',
  biz_id     BIGINT UNSIGNED NOT NULL COMMENT '对应 forum_thread.id / forum_reply.id',
  author_id  BIGINT UNSIGNED NOT NULL,
  verdict    VARCHAR(12) NOT NULL COMMENT 'ok/suspect/violation/degraded（degraded=AI 超时或失败，视为放行待复核）',
  categories VARCHAR(128) NOT NULL DEFAULT '' COMMENT '违规分类，逗号分隔',
  confidence DECIMAL(4,3) NULL COMMENT '模型自评置信度 0~1',
  reason     VARCHAR(512) NOT NULL DEFAULT '' COMMENT '模型给出的一句话理由',
  excerpt    VARCHAR(255) NOT NULL DEFAULT '' COMMENT '被判定内容摘要（便于人工复核）',
  handled    TINYINT NOT NULL DEFAULT 0 COMMENT '0 待复核 1 已确认违规 2 判定误判（放行）',
  handled_by BIGINT UNSIGNED NULL,
  handled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_handled_time (handled, created_at),
  KEY idx_biz (biz, biz_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'AI 内容审核留痕与人工复核队列';

-- ---------- 5. 告警邮件留痕（C3） ----------
CREATE TABLE IF NOT EXISTS ai_alert_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type       VARCHAR(32)  NOT NULL COMMENT 'content_violation/system_500/ai_failure/login_bruteforce/other',
  dedupe_key VARCHAR(128) NOT NULL DEFAULT '' COMMENT '同类告警去重键',
  title      VARCHAR(255) NOT NULL,
  detail     VARCHAR(1024) NOT NULL DEFAULT '',
  sent_to    VARCHAR(512) NOT NULL DEFAULT '' COMMENT '实际收件人（逗号分隔）',
  ok         TINYINT NOT NULL DEFAULT 0 COMMENT '1 发送成功 0 失败',
  err        VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_type_time (type, created_at),
  KEY idx_dedupe_time (dedupe_key, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '告警邮件发送记录（去重依据）';

-- ---------- 6. 既有表增列（全部 IF NOT EXISTS，可重复执行） ----------
-- 论坛内容审核状态：0 正常 1 待人工复核 2 已确认违规（隐藏）
ALTER TABLE forum_thread ADD COLUMN IF NOT EXISTS review_status TINYINT NOT NULL DEFAULT 0 COMMENT 'AI 审核状态 0正常 1待复核 2已确认违规';
ALTER TABLE forum_reply  ADD COLUMN IF NOT EXISTS review_status TINYINT NOT NULL DEFAULT 0 COMMENT 'AI 审核状态 0正常 1待复核 2已确认违规';
-- 公告 AI 摘要（C9）
ALTER TABLE af_notice ADD COLUMN IF NOT EXISTS summary VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'AI 生成的公告摘要（≤80字）';
-- 报修 AI 分诊结果（C8）：JSON 字符串 {urgency,dept,selfService,reason}
ALTER TABLE af_repair ADD COLUMN IF NOT EXISTS ai_triage VARCHAR(512) NOT NULL DEFAULT '' COMMENT 'AI 智能分诊结果 JSON';

-- ---------- 7. AI 配置默认值（幂等：已存在则不覆盖） ----------
INSERT IGNORE INTO sys_config (cfg_key, cfg_value, remark) VALUES
  ('ai.enabled',                          '1',    'AI 总开关（关闭=全站 AI 静默降级）'),
  ('ai.chat.enabled',                     '1',    'C1 校园智能问答'),
  ('ai.chat.rate_per_min',                '10',   '每用户每分钟问答次数上限'),
  ('ai.chat.daily_per_user',              '200',  '每用户每日问答次数上限'),
  ('ai.forum_review.enabled',             '0',    'C2 论坛 AI 审核员（默认关，需管理员开启）'),
  ('ai.forum_review.block_on_violation',  '1',    'C2 判定违规时是否直接拦截发帖'),
  ('ai.forum_review.timeout_ms',          '3000', 'C2 审核超时（超时=放行并标记待复核）'),
  ('ai.alert.enabled',                    '0',    'C3 异常告警邮件总开关'),
  ('ai.alert.emails',                     '',     'C3 收件人（逗号分隔；留空则取 admin 角色用户的校园邮箱）'),
  ('ai.alert.dedupe_min',                 '30',   'C3 同类告警去重窗口（分钟）'),
  ('ai.approval_advice.enabled',          '0',    'C4 AI 审批助手（只建议，不自动审批）'),
  ('ai.admin_console.enabled',            '1',    'C5 管理员智能管理'),
  ('ai.insight.enabled',                  '1',    'C6 校领导信息汇总问数'),
  ('ai.study.enabled',                    '1',    'C7 学生学业助手'),
  ('ai.triage.enabled',                   '0',    'C8 报修智能分诊'),
  ('ai.notice_summary.enabled',           '0',    'C9 公告 AI 摘要'),
  ('ai.lf_match.enabled',                 '0',    'C10 失物招领智能匹配'),
  ('ai.anomaly.enabled',                  '0',    'C11 数据异常监测'),
  ('ai.lib_search.enabled',               '1',    'C12 图书自然语言检索'),
  ('ai.kb.inline_max_chars',              '4000', '知识库全量注入阈值（超出则走关键词召回 TopK；实测检索比全量注入省 95% token 且命中率 90%+）');
