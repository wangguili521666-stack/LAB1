#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
for service in d1 d2 d3 m1 m2 m3; do
  docker compose exec -T "$service" npm run migrate
done
