-- D3 独立逻辑库；只含 D3 自有表。DATETIME(3) 统一存储 UTC。
-- 用户 ID 是 D1 的逻辑引用，不跨库建外键。
CREATE TABLE d3_notifications (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_module VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_type VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  biz_type VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  biz_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  trace_id VARCHAR(64) NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NULL,
  invalidated_at DATETIME(3) NULL,
  UNIQUE KEY uq_d3_notification_event (source_module, source_event_id, notification_type),
  KEY idx_d3_notification_business (source_module, biz_type, biz_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE d3_notification_recipients (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  notification_id BIGINT NOT NULL,
  recipient_user_id BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  read_at DATETIME(3) NULL,
  UNIQUE KEY uq_d3_notification_user (notification_id, recipient_user_id),
  KEY idx_d3_inbox (recipient_user_id, created_at, id),
  KEY idx_d3_unread (recipient_user_id, read_at, created_at, id),
  CONSTRAINT fk_d3_recipient_notification FOREIGN KEY (notification_id) REFERENCES d3_notifications(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE announcements (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  type VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  publisher_id BIGINT NOT NULL,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  published_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  withdrawn_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  KEY idx_d3_announcement_public (status, published_at, id),
  CONSTRAINT chk_d3_announcement_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN')),
  CONSTRAINT chk_d3_announcement_type CHECK (type IN ('NOTICE', 'MAINTENANCE', 'EMERGENCY')),
  CONSTRAINT chk_d3_announcement_version CHECK (version > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE operation_logs (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NULL,
  module VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
  target_type VARCHAR(50) COLLATE utf8mb4_bin NULL,
  target_id BIGINT NULL,
  request_method VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NULL,
  request_path VARCHAR(255) NULL,
  result VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ip_address VARCHAR(45) NULL,
  reason VARCHAR(1000) NULL,
  trace_id VARCHAR(64) NULL,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_d3_log_event (module, source_event_id),
  KEY idx_d3_log_time (created_at, id),
  KEY idx_d3_log_module (module, created_at, id),
  KEY idx_d3_log_user (user_id, created_at, id),
  CONSTRAINT chk_d3_log_result CHECK (result IN ('SUCCESS', 'FAILURE', 'DENIED')),
  CONSTRAINT chk_d3_log_actor CHECK (actor_type IN ('USER', 'SYSTEM', 'SERVICE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
