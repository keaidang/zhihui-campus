-- ============================================================
-- 智汇校园 · 业务脚本 010：宿舍管理（替代 M2 的"宿舍报修"独立入口）
--   宿舍管理 = 楼栋/房间/住宿分配（admin） + 我的宿舍/宿舍报修（学生）
--   报修复用 af_repair 表与 /api/af/repair 接口（提交时自动带出住宿位置）
-- 目标库: zhihui_campus (TiDB Serverless, MySQL 8.0 兼容)
-- 设计要点:
--   * sys_user.gender：0未知 1男 2女（宿舍分配的性别约束依据）
--   * dorm_building.gender：楼栋性别属性（male/female），约束入住
--   * dorm_assignment 唯一键 (user_id)：一人一个在住床位，check_out_at 置值即退宿（留历史）
--   * dorm_room.occupied 冗余计数，与 assignment 变更同事务维护
-- ============================================================

-- 1. 用户性别（宿舍分配依据；默认 0 未知，种子脚本批量补齐学生）
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS gender TINYINT NOT NULL DEFAULT 0 COMMENT '性别 0未知 1男 2女';

-- 2. 宿舍楼栋
CREATE TABLE IF NOT EXISTS dorm_building (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(32) NOT NULL COMMENT '楼栋名 如 1栋',
  gender     VARCHAR(8)  NOT NULL DEFAULT 'male' COMMENT '楼栋性别属性 male/female',
  floors     INT         NOT NULL DEFAULT 6 COMMENT '楼层数',
  note       VARCHAR(128) NOT NULL DEFAULT '',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_name (name)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '宿舍楼栋';

-- 3. 宿舍房间
CREATE TABLE IF NOT EXISTS dorm_room (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  building_id BIGINT UNSIGNED NOT NULL,
  room_no     VARCHAR(16) NOT NULL COMMENT '房号 如 312',
  floor       INT         NOT NULL DEFAULT 1,
  capacity    INT         NOT NULL DEFAULT 4 COMMENT '床位数',
  occupied    INT         NOT NULL DEFAULT 0 COMMENT '已入住人数（冗余，与分配同事务维护）',
  status      TINYINT     NOT NULL DEFAULT 1 COMMENT '1可入住 0停用',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_building_room (building_id, room_no),
  KEY idx_status (status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '宿舍房间';

-- 4. 住宿分配（生成列 uk：在住(user)唯一，退宿历史不占约束——MySQL 唯一键对 NULL 不去重，
--    故用生成列在住=1/退宿=NULL 实现"一人最多一条在住"的数据库级约束，退宿后可再分配）
CREATE TABLE IF NOT EXISTS dorm_assignment (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  bed_no      INT         NOT NULL DEFAULT 0 COMMENT '床位号 1..capacity',
  check_in_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  check_out_at DATETIME   NULL COMMENT 'NULL=在住',
  active_flag TINYINT GENERATED ALWAYS AS (IF(check_out_at IS NULL, 1, NULL)) STORED,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_active (user_id, active_flag),
  KEY idx_room (room_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '住宿分配';

-- 5. 楼栋种子（8 栋：1-4 男寝，5-8 女寝，幂等）
INSERT INTO dorm_building (name, gender, floors, note)
SELECT '1栋', 'male', 6, '男生宿舍' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM dorm_building WHERE name = '1栋');
INSERT INTO dorm_building (name, gender, floors, note)
SELECT '2栋', 'male', 6, '男生宿舍' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM dorm_building WHERE name = '2栋');
INSERT INTO dorm_building (name, gender, floors, note)
SELECT '3栋', 'male', 6, '男生宿舍' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM dorm_building WHERE name = '3栋');
INSERT INTO dorm_building (name, gender, floors, note)
SELECT '4栋', 'male', 6, '男生宿舍' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM dorm_building WHERE name = '4栋');
INSERT INTO dorm_building (name, gender, floors, note)
SELECT '5栋', 'female', 6, '女生宿舍' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM dorm_building WHERE name = '5栋');
INSERT INTO dorm_building (name, gender, floors, note)
SELECT '6栋', 'female', 6, '女生宿舍' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM dorm_building WHERE name = '6栋');
INSERT INTO dorm_building (name, gender, floors, note)
SELECT '7栋', 'female', 6, '女生宿舍' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM dorm_building WHERE name = '7栋');
INSERT INTO dorm_building (name, gender, floors, note)
SELECT '8栋', 'female', 6, '女生宿舍' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM dorm_building WHERE name = '8栋');
