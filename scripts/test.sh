#!/usr/bin/env bash
# Stable entry point for local tests and CodeArts; ci.sh owns isolated setup.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-unit}"
case "$MODE" in unit|full) ;; *) echo 'Usage: bash scripts/test.sh [unit|full]' >&2; exit 2;; esac
mkdir -p "$ROOT/test-results"
REPORT_DIR="$(mktemp -d "$ROOT/test-results/run-${MODE}.XXXXXXXX")"
REPORT="$REPORT_DIR/output.log"
echo "测试模式: $MODE; 日志: $REPORT"
set +e
bash "$ROOT/scripts/ci.sh" "$MODE" 2>&1 | tee "$REPORT"
results=("${PIPESTATUS[@]}")
set -e
status="${results[0]}"
if [[ "$status" == 0 && "${results[1]}" != 0 ]]; then status="${results[1]}"; fi
printf 'mode=%s\nexit_code=%s\n' "$MODE" "$status" > "$REPORT_DIR/status.txt"
if [[ "$status" == 0 ]]; then
  echo "测试入口执行成功（${MODE}）；请查看日志中的跳过项。"
else
  echo "测试失败，退出码 ${status}。日志: $REPORT" >&2
fi
exit "$status"
