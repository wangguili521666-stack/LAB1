#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=${LAB1_ROOT:-/opt/lab1}
mkdir -p "$ROOT/releases" "$ROOT/shared"
exec 9>"$ROOT/deploy.lock"
flock -w 900 9 || { echo '另一发布仍在运行'; exit 1; }
mode=${1:-status}
current=$(readlink -f "$ROOT/current" 2>/dev/null || true)
compose() { docker compose --project-name lab1 --env-file "$ROOT/shared/.env" -f "$1/compose.json" "${@:2}"; }
if [[ "$mode" == status ]]; then
  [[ -n "$current" && -f "$current/release.json" ]] || { echo '尚无已发布版本'; exit 1; }
  cat "$current/release.json"; compose "$current" ps; exit
fi
if [[ "$mode" == rollback ]]; then
  target=${2:?需要完整版本号}
  [[ "$target" =~ ^[a-f0-9]{40}-[a-z0-9]+-[0-9]+$ ]] || exit 2
  next="$ROOT/releases/$target"
  [[ -f "$next/release.json" && -f "$current/release.json" ]] || { echo '回滚版本不存在'; exit 1; }
  python3 - "$current/release.json" "$next/release.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['schema']==json.load(open(sys.argv[2]))['schema'], 'Schema不同，禁止自动降级数据库；需要经过评审的前向兼容方案'
PY
elif [[ "$mode" == deploy ]]; then
  archive=$(realpath "${2:?需要发布包}")
  (cd "$(dirname "$archive")"; sha256sum -c "$(basename "$archive").sha256")
  stage=$(mktemp -d "$ROOT/releases/.incoming.XXXXXX")
  trap 'rm -rf "${stage:-}"' EXIT
  # Reject path traversal, links and special files before extraction.
  python3 - "$archive" "$stage" <<'PY'
import tarfile,sys,pathlib
with tarfile.open(sys.argv[1]) as t:
 for m in t.getmembers():
  p=pathlib.PurePosixPath(m.name)
  assert not p.is_absolute() and '..' not in p.parts and (m.isfile() or m.isdir()), '非法归档成员'
 t.extractall(sys.argv[2],filter='data')
PY
  target=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["release"])' "$stage/release.json")
  [[ "$target" =~ ^[a-f0-9]{40}-[a-z0-9]+-[0-9]+$ ]] || exit 2
  next="$ROOT/releases/$target"
  if [[ -d "$next" ]]; then
    cmp "$stage/release.json" "$next/release.json"
    rm -rf "$stage"
  else mv "$stage" "$next"; fi
  stage=''; trap - EXIT
  if [[ ! -f "$ROOT/shared/.env" ]]; then
    python3 - "$next/.env.example" "$ROOT/shared/.env" <<'PY'
import sys,secrets,re,os
s=open(sys.argv[1]).read()
s=re.sub(r'^([A-Z][A-Z0-9_]*)=(.*)$',lambda m:m[1]+'='+secrets.token_hex(32) if any(x in m[1] for x in ['PASSWORD','TOKEN','SECRET']) else m[0],s,flags=re.M)
with open(sys.argv[2],'x') as f:f.write(s+'\nLAB1_PORT=80\n')
os.chmod(sys.argv[2],0o600)
PY
  fi
  ln -sfn "$ROOT/shared/.env" "$next/.env"
  docker load -i "$next/images.tar"
else echo '用法: server-release.sh deploy 包 | rollback 版本 | status'; exit 2; fi
compose "$next" config --quiet
if ! compose "$next" up -d --no-build --pull never --wait --wait-timeout 600; then
  echo '发布失败；未更新当前成功版本。请检查容器和迁移状态。' >&2
  exit 1
fi
# Only advance the pointer after all seven application services and MySQL are healthy.
[[ -z "$current" || ! -f "$current/release.json" ]] || ln -sfn "$current" "$ROOT/previous"
ln -sfn "$next" "$ROOT/current"
install -m 700 "$next/server-release.sh" "$ROOT/server-release.sh"
python3 - "$next/release.json" "$mode" >> "$ROOT/deployments.jsonl" <<'PY'
import sys,json,datetime
x=json.load(open(sys.argv[1]));x.update(action=sys.argv[2],deployedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());print(json.dumps(x))
PY
cat "$next/release.json"
