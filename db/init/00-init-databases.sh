#!/usr/bin/env bash
# 在单个 MySQL 实例内为六个模块建立「逻辑隔离」：
#   - 每个模块一个独立数据库（campus_m1 ... campus_d3）
#   - 每个模块一个专属账号（m1_app ... d3_app），仅拥有本库权限
#   - 模块之间无法通过 SQL 访问对方库（即便共用同一实例）
# 本脚本只负责「库 + 账号」；业务表请在各模块自己的版本化迁移脚本中创建。
set -euo pipefail

ROOT_PW="${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD 未设置}"

create_db() {
  local module="$1" password="$2"
  local db="campus_${module}"
  local user="${module}_app"

  mysql -uroot -p"${ROOT_PW}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${user}'@'%';
SQL
  echo "OK  ${db}  <-  账号 ${user}（仅本库权限）"
}

create_db m1 "${M1_DB_PASSWORD:?}"
create_db m2 "${M2_DB_PASSWORD:?}"
create_db m3 "${M3_DB_PASSWORD:?}"
create_db d1 "${D1_DB_PASSWORD:?}"
create_db d2 "${D2_DB_PASSWORD:?}"
create_db d3 "${D3_DB_PASSWORD:?}"

echo "完成：6 个独立数据库与 6 个最小权限账号已就绪。"
