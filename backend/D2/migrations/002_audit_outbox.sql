-- 2026-10-28 用户批准：D2 本地审计 outbox；不读写 D3 数据库。
CREATE TABLE IF NOT EXISTS operation_log_outbox (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payload JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error_code VARCHAR(50) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  KEY idx_outbox_pending (status, next_attempt_at, id),
  CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING', 'SENT')),
  CONSTRAINT chk_outbox_attempts CHECK (attempts >= 0),
  CONSTRAINT chk_outbox_payload CHECK (JSON_TYPE(payload) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
