#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077

command -v docker >/dev/null || { echo '请先安装 Docker Desktop。'; exit 1; }
if ! docker info >/dev/null 2>&1; then
  echo '正在启动 Docker Desktop…'
  docker desktop start --timeout 60 || { echo '请手动打开 Docker Desktop，等待就绪后重试。'; exit 1; }
fi

# Only generate credentials for a new environment; never replace existing database passwords.
if [ ! -f .env ]; then
  command -v openssl >/dev/null || { echo '首次配置需要 openssl 生成随机密码。'; exit 1; }
  config_tmp=$(mktemp .env.init.XXXXXX)
  trap 'rm -f "$config_tmp"' EXIT
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *_PASSWORD=*|D1_JWT_SECRET=*) printf '%s=%s\n' "${line%%=*}" "$(openssl rand -hex 32)" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.example > "$config_tmp"
  mv "$config_tmp" .env
  trap - EXIT
  echo '已生成本地 .env 配置。'
fi
if ! grep -Eq '^D1_JWT_SECRET=.+$' .env; then
  command -v openssl >/dev/null || { echo '需要 openssl 生成登录签名密钥。'; exit 1; }
  printf '\nD1_JWT_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
fi

docker compose config --quiet
echo '正在构建并启动 MySQL、D1、M2 和前端，首次运行需要下载依赖…'
if ! docker compose up -d --build --wait --wait-timeout 180 mysql d1 m2 frontend; then
  echo '启动未完成。请运行 docker compose ps 和 docker compose logs --tail=80 mysql d1 m2 frontend 查看原因。'
  exit 1
fi
frontend_address=$(docker compose port frontend 5173)
printf '\n启动成功，访问：http://%s/login\n' "$frontend_address"
echo '停止本项目：docker compose stop'
echo '当前包含前端、D1 用户服务、M2 教室申请服务和 MySQL；M1、M3、D2、D3 尚未实现。'
