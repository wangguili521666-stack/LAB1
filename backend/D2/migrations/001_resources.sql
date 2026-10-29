-- D2 主数据。college_id 经已批准方案作为 D1 的逻辑引用，不跨库建外键。
CREATE TABLE IF NOT EXISTS classrooms (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  building VARCHAR(100) NOT NULL,
  room_number VARCHAR(30) NOT NULL,
  college_id BIGINT NULL,
  capacity INT NOT NULL,
  equipment JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  is_bookable_whole BOOLEAN NOT NULL,
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_classrooms_college (college_id),
  KEY idx_classrooms_location (building, room_number),
  KEY idx_classrooms_status (status),
  CONSTRAINT chk_classroom_college CHECK (college_id IS NULL OR college_id > 0),
  CONSTRAINT chk_classroom_capacity CHECK (capacity > 0),
  CONSTRAINT chk_classroom_equipment CHECK (JSON_TYPE(equipment) = 'OBJECT'),
  CONSTRAINT chk_classroom_status CHECK (status IN ('AVAILABLE', 'MAINTENANCE', 'DISABLED')),
  CONSTRAINT chk_classroom_whole CHECK (is_bookable_whole IN (0, 1)),
  CONSTRAINT chk_classroom_open CHECK (open_time BETWEEN '00:00:00' AND '23:59:59'),
  CONSTRAINT chk_classroom_close CHECK (close_time BETWEEN '00:00:00' AND '23:59:59')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seats (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  classroom_id BIGINT NOT NULL,
  seat_number VARCHAR(20) NOT NULL,
  socket_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_seats_classroom (classroom_id),
  KEY idx_seats_filters (classroom_id, status, socket_type),
  CONSTRAINT fk_seats_classroom FOREIGN KEY (classroom_id) REFERENCES classrooms (id),
  CONSTRAINT chk_seat_socket CHECK (socket_type IN ('NONE', 'FIXED', 'RAIL')),
  CONSTRAINT chk_seat_status CHECK (status IN ('AVAILABLE', 'MAINTENANCE', 'DISABLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
