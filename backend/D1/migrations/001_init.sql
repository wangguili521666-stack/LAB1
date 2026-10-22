-- D1 模块表结构，与 docs/requirements/databaseDescription.md 保持一致。
-- 所有 D1 表只存在于 campus_d1 库（由 db/init 创建），账号 d1_app 仅能访问本库。

CREATE TABLE IF NOT EXISTS colleges (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  role_code VARCHAR(50) NOT NULL UNIQUE,
  role_name VARCHAR(50) NOT NULL,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  permission_code VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nickname VARCHAR(50) NULL,
  email VARCHAR(100) NULL,
  phone VARCHAR(20) NULL,
  college_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_users_college (college_id),
  CONSTRAINT fk_users_college FOREIGN KEY (college_id) REFERENCES colleges (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id_role BIGINT NOT NULL,
  id_permissions BIGINT NOT NULL,
  PRIMARY KEY (id_role, id_permissions),
  CONSTRAINT fk_role_perm_role FOREIGN KEY (id_role) REFERENCES roles (id) ON DELETE CASCADE,
  CONSTRAINT fk_role_perm_perm FOREIGN KEY (id_permissions) REFERENCES permissions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
