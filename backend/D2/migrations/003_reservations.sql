CREATE TABLE IF NOT EXISTS resource_reservations (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  resource_type VARCHAR(20) NOT NULL,
  resource_id BIGINT NOT NULL,
  classroom_id BIGINT NOT NULL,
  source_module VARCHAR(10) NOT NULL,
  source_id BIGINT NOT NULL,
  start_time DATETIME(3) NOT NULL,
  end_time DATETIME(3) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'HELD',
  hold_expires_at DATETIME(3) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_reservations_source (source_module, source_id),
  KEY idx_reservations_conflict (classroom_id, status, start_time, end_time),
  KEY idx_reservations_expiry (status, hold_expires_at, id),
  CONSTRAINT fk_reservations_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms (id),
  CONSTRAINT chk_reservation_resource CHECK (resource_id > 0 AND source_id > 0),
  CONSTRAINT chk_reservation_type CHECK (
    (source_module = 'M1' AND resource_type = 'SEAT') OR (source_module = 'M2' AND resource_type = 'CLASSROOM')),
  CONSTRAINT chk_reservation_classroom CHECK (resource_type <> 'CLASSROOM' OR resource_id = classroom_id),
  CONSTRAINT chk_reservation_interval CHECK (start_time < end_time),
  CONSTRAINT chk_reservation_status CHECK (status IN ('HELD', 'CONFIRMED', 'RELEASED')),
  CONSTRAINT chk_reservation_held CHECK (status <> 'HELD' OR hold_expires_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
