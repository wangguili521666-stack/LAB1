-- M2 模块表结构，与 docs/requirements/databaseDescription.md 保持一致。
-- 申请人、教室、资源预占属于其他模块，这里只保存 ID，不建跨库外键。

CREATE TABLE IF NOT EXISTS classroom_applications (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  applicant_id BIGINT NOT NULL,
  classroom_id BIGINT NOT NULL,
  reservation_id BIGINT NULL,
  purpose VARCHAR(255) NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  status VARCHAR(30) NOT NULL,
  approval_deadline DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_applicant_created (applicant_id, id),
  KEY idx_status_deadline (status, approval_deadline),
  KEY idx_classroom (classroom_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS application_approvals (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  application_id BIGINT NOT NULL,
  approval_level TINYINT NOT NULL,
  approver_id BIGINT NOT NULL,
  decision VARCHAR(20) NOT NULL,
  comment TEXT NULL,
  decided_at DATETIME NOT NULL,
  UNIQUE KEY uk_application_level (application_id, approval_level),
  CONSTRAINT fk_approvals_application FOREIGN KEY (application_id) REFERENCES classroom_applications (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
