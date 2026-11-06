#!/usr/bin/env bash
set -Eeuo pipefail
# Prevent package scripts from recursively re-entering the CI pipeline.
if [[ "${LAB1_CI_ACTIVE:-0}" == 1 ]]; then
  echo '检测到 CI 递归调用：ci.sh 内不能调用根目录的 npm test、npm run test:all 或 npm run ci。' >&2
  exit 2
fi
export LAB1_CI_ACTIVE=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-full}"
case "$MODE" in full|unit) ;; *) echo 'Usage: bash scripts/ci.sh [full|unit]' >&2; exit 2;; esac
for tool in node npm tar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "CI 环境缺少 $tool。请在 CodeArts 的 Npm 构建步骤选择 Node.js 22 或更高版本，并在同一步骤执行本脚本；完整模式还要求 Docker 服务和 Compose。详见 docs/codearts-ci.md。" >&2
    exit 127
  fi
done
node "$ROOT/scripts/requirements-check.mjs"
node --test "$ROOT/scripts/requirements-check.test.mjs"
node -e 'if (+process.versions.node.split(".")[0] < 22) throw Error("Node.js >=22 required")'
if [[ "$MODE" == full ]]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo '完整 CI 需要可用的 Docker Engine 和 Compose。请配置支持 Docker 的执行机；仅验证单元测试与前端构建可显式使用 unit 模式。' >&2
    exit 1
  fi
fi
WORK="$(mktemp -d "${TMPDIR:-/tmp}/campus-ci.XXXXXXXX")"
export COMPOSE_PROJECT_NAME="campus-ci-$(date +%s)-$$"
export COMPOSE_FILE="$WORK/docker-compose.yml"
started=0
build_started=0
# Explicit per-run image tags allow safe cleanup without touching base images.
image_services=(frontend d1 d2 d3 m1 m2 m3)
cleanup() {
  result=$?
  trap - EXIT
  if [[ "$started" == 1 ]]; then
    if [[ "$result" != 0 ]]; then docker compose logs --no-color --tail=80 >&2 || true; fi
    if ! docker compose down --volumes --remove-orphans; then
      echo "测试容器清理失败，请检查项目 $COMPOSE_PROJECT_NAME" >&2
      [[ "$result" != 0 ]] || result=1
    fi
  fi
  if [[ "$build_started" == 1 ]]; then
    for service in "${image_services[@]}"; do
      tag="${COMPOSE_PROJECT_NAME}-${service}:latest"
      # Some services may not have built when the build command fails.
      if docker image inspect "$tag" >/dev/null 2>&1; then
        if ! docker image rm "$tag"; then
          echo "测试镜像清理失败: ${tag}（不强制删除仍被使用的镜像）" >&2
          [[ "$result" != 0 ]] || result=1
        fi
      elif ! docker info >/dev/null 2>&1; then
        echo 'Docker 服务不可用，无法确认测试镜像是否已清理。' >&2
        [[ "$result" != 0 ]] || result=1
      fi
    done
  fi
  rm -rf "$WORK"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A clean copy prevents dotenv/test helpers from touching the developer database.
tar -C "$ROOT" --exclude=node_modules --exclude=.env --exclude=.git --exclude=dist --exclude=artifacts --exclude=test-results --exclude=.local-logs -cf - . | tar -C "$WORK" -xf -
cd "$WORK"
node --input-type=module <<'JS'
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
const env=fs.readFileSync('.env.example','utf8').replace(/^([A-Z][A-Z0-9_]*)=(.*)$/gm,(line,key)=> /PASSWORD|SECRET|TOKEN/.test(key)?`${key}=${randomBytes(24).toString('hex')}`:line);
fs.writeFileSync('.env',env+'\nFRONTEND_PORT=0\n', {mode:0o600});
let compose=fs.readFileSync('docker-compose.yml','utf8');
compose=compose.replace('${MYSQL_PORT:-3306}:3306','127.0.0.1::3306');
// Pin names to this run; only these seven tags will be removed on exit.
for (const service of ['frontend','d1','d2','d3','m1','m2','m3']) {
  const marker = `  ${service}:\n`;
  if (!compose.includes(marker)) throw Error(`Missing Compose service: ${service}`);
  compose = compose.replace(new RegExp(`^  ${service}:\\n`, 'm'), `${marker}    image: ${process.env.COMPOSE_PROJECT_NAME}-${service}:latest\n`);
}
fs.writeFileSync('docker-compose.yml',compose);
JS
for module in frontend backend/{D1,D2,D3,M1,M2,M3}; do
  echo "=== Install and check: $module ==="
  (cd "$module"; npm ci --no-audit --no-fund)
  while IFS= read -r -d '' file; do node --check "$file"; done < <(find "$module/src" -type f \( -name '*.js' -o -name '*.mjs' \) -print0)
done
for module in frontend backend/{D1,D2,D3,M1,M3}; do
  (cd "$module"; npm test)
done
mkdir -p test-results
node scripts/mutation.mjs
(cd frontend; npm run build)
if [[ "$MODE" == unit ]]; then
  echo 'Unit/build checks passed; MySQL, M2 and Compose integration NOT run.'
  exit 0
fi
docker compose version
docker info >/dev/null
docker compose config --quiet
# Reuse local base images and BuildKit layers; do not use --pull or --no-cache.
# Enable cleanup BEFORE building, including partial-build failures.
build_started=1
DOCKER_BUILDKIT=1 docker compose build
started=1
docker compose up -d --no-build --wait --wait-timeout 240
# Fresh isolated database has already replayed every migration during startup.
# Replay twice to verify history skipping and seed idempotency before API tests.
for replay in 1 2; do
  for service in d1 d2 d3 m1 m2 m3; do
    docker compose exec -T "$service" npm run migrate
  done
done
mysql_port="$(docker compose port mysql 3306 | tail -1)"
mysql_port="${mysql_port##*:}"
# Provision a separate M2 test schema inside this disposable MySQL container.
export M2_TEST_DB_HOST=127.0.0.1 M2_TEST_DB_PORT="$mysql_port"
export M2_TEST_DB_NAME="lab1_it_ci_$$_m2" M2_TEST_DB_USER=ci_m2
export M2_TEST_DB_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
const { M2_TEST_DB_NAME: db, M2_TEST_DB_PASSWORD: password } = process.env;
if (!/^lab1_it_ci_[0-9]+_m2$/.test(db) || !/^[a-f0-9]{48}$/.test(password)) throw Error('Invalid CI database settings');
const sql = `CREATE DATABASE ${db}; CREATE USER 'ci_m2'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON ${db}.* TO 'ci_m2'@'%';`;
execFileSync('docker', ['compose', 'exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
JS
(cd backend/M2; npm test)
(cd backend/D2; npm run test:integration)

# D3 database tests must run against a dedicated schema and a non-root account.
export D3_TEST_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
const password=process.env.D3_TEST_PASSWORD;
if (!/^[a-f0-9]{48}$/.test(password)) throw Error('Invalid D3 test password');
const sql=`CREATE DATABASE d3_isolated_test; CREATE USER 'd3_test'@'%' IDENTIFIED BY '${password}'; GRANT ALL ON d3_isolated_test.* TO 'd3_test'@'%';`;
execFileSync('docker',['compose','exec','-T','mysql','sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root'],{input:sql,stdio:['pipe','inherit','inherit']});
JS
export D3_TEST_PORT="$mysql_port"
D3_TEST_MYSQL="$(node <<'JS'
console.log(JSON.stringify({host:'127.0.0.1',port:Number(process.env.D3_TEST_PORT),user:'d3_test',password:process.env.D3_TEST_PASSWORD,database:'d3_isolated_test'}));
JS
)"
export D3_TEST_MYSQL
node -e 'if (!JSON.parse(process.env.D3_TEST_MYSQL).password) throw Error("Missing D3 test credentials")'
(cd backend/D3; node --test --test-concurrency=1 test/*.test.js)
unset D3_TEST_MYSQL D3_TEST_PASSWORD D3_TEST_PORT

frontend_port="$(docker compose port frontend 5173 | tail -1)"
TEST_BASE_URL="http://127.0.0.1:${frontend_port##*:}" node scripts/integration.mjs
echo 'CI build, tests and Compose integration passed.'
