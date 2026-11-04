#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
case "${1:-status}" in
 up) exec bash start.sh ;;
 status) exec docker compose ps ;;
 stop) exec docker compose stop ;;
 *) echo '用法: npm run infra:up | infra:status | infra:stop' >&2; exit 2 ;;
esac
