-- 已批准的 D2 维修来源追踪；工单只通过 M3 公开 HTTP 同步，不查询 M3 数据库。
CREATE TABLE IF NOT EXISTS maintenance_blocks (
  ticket_id BIGINT NOT NULL PRIMARY KEY,
  classroom_id BIGINT NOT NULL,
  active BOOLEAN NOT NULL,
  revision INT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_maintenance_classroom (classroom_id, active),
  CONSTRAINT fk_maintenance_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms (id),
  CONSTRAINT chk_maintenance_ticket CHECK (ticket_id > 0),
  CONSTRAINT chk_maintenance_active CHECK (active IN (0, 1)),
  CONSTRAINT chk_maintenance_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
