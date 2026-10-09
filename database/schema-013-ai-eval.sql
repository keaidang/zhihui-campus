-- ============================================================
-- 智汇校园 · 业务脚本 013：AI 效果评估（可量化指标）
--
-- 设计依据：信息工程系《2026 年度毕业设计实施方案》
--   §四（二）实效性要求：
--     「可量化：明确 AI 模型/系统的评估指标（如准确率、召回率、F1、
--       效率提升%）并给出结果」
--   本文件提供**产出这些指标所需的数据结构**——指标不是手写的，
--   而是跑出来的：管理员在控制台点一次「运行评估」，逐条用例调真实
--   判定链路，结果落 ai_eval_run，页面直接读它出报表。
--
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
--
-- 设计要点:
--   * ai_eval_case —— 评估用例（场景 + 输入 + 期望 + 标注依据）。
--      幂等键用 md5(scene + input) 而不是 UNIQUE(scene, input)：
--      input 最长 1024，utf8mb4 下建联合唯一索引会超 TiDB 的索引长度
--      上限，改用固定 32 位哈希列最省事也最稳。
--   * ai_eval_run  —— 每次运行的汇总 + 逐条明细（JSON 存 MEDIUMTEXT）。
--      保留历史，可展示"指标随版本演进"的趋势 —— 这在答辩时比单个
--      数字更有说服力（能说明你迭代过、而且改进了）。
--   * **只读评测**：评估只调用各能力的"判定"环节，不写报修工单、
--      不写论坛帖、不发公告，因此可以反复运行而不污染业务数据。
--      这是本设计能"随时现场演示"的前提。
-- ============================================================

-- ---------- 1. 评估用例（标注数据集） ----------
CREATE TABLE IF NOT EXISTS ai_eval_case (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scene      VARCHAR(32)  NOT NULL COMMENT '场景：qa 知识问答 / triage 报修分诊 / review 论坛审核 / insight 信息问数',
  hash       CHAR(32)     NOT NULL COMMENT 'md5(scene + input)，幂等键',
  input      VARCHAR(1024) NOT NULL COMMENT '用例输入：问题 / 报修描述 / 帖子标题+正文 / 问数问法',
  expect     VARCHAR(255) NOT NULL COMMENT '期望值。qa=命中关键词；triage=部门|紧急度；review=verdict；insight=模板 key',
  note       VARCHAR(255) NOT NULL DEFAULT '' COMMENT '标注依据（谁按什么标准标的，答辩时可解释）',
  status     TINYINT      NOT NULL DEFAULT 1 COMMENT '1 启用 0 停用（停用后可保留历史而不参与跑分）',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_hash (hash),
  KEY idx_scene_status (scene, status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'AI 效果评估用例（人工标注数据集）';

-- ---------- 2. 评估运行记录（指标来源） ----------
CREATE TABLE IF NOT EXISTS ai_eval_run (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scene       VARCHAR(32) NOT NULL COMMENT '场景',
  total       INT         NOT NULL DEFAULT 0 COMMENT '本次参与用例数',
  passed      INT         NOT NULL DEFAULT 0 COMMENT '判定正确数',
  failed      INT         NOT NULL DEFAULT 0 COMMENT '判定错误数',
  skipped     INT         NOT NULL DEFAULT 0 COMMENT '跳过数（能力未开启、上游未响应等）',
  avg_ms      INT         NOT NULL DEFAULT 0 COMMENT '平均耗时（毫秒）',
  accuracy    DECIMAL(5,4) NOT NULL DEFAULT 0 COMMENT '准确率 = passed / (passed + failed)',
  detail      MEDIUMTEXT  NULL COMMENT '逐条结果 JSON：[{caseId,input,expect,actual,ok,ms,note}]',
  operator_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '触发人 sys_user.id（0=脚本）',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_scene_time (scene, created_at),
  KEY idx_time (created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = 'AI 效果评估运行记录';
