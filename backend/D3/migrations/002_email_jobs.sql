CREATE TABLE IF NOT EXISTS d3_email_jobs (
 id BIGINT PRIMARY KEY AUTO_INCREMENT,
 notification_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
 attempts INT NOT NULL DEFAULT 0,
 next_attempt_at DATETIME(3) NOT NULL,
 sent_at DATETIME(3) NULL,
 last_error VARCHAR(64) NULL,
 UNIQUE KEY uq_email_recipient(notification_id,user_id),
 KEY idx_email_pending(status,next_attempt_at),
 FOREIGN KEY (notification_id) REFERENCES d3_notifications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
