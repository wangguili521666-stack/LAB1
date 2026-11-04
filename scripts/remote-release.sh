#!/usr/bin/env bash
set -Eeuo pipefail
: "${DEPLOY_HOST:?}" "${DEPLOY_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
printf '%s\n' "$DEPLOY_KEY" > "$work/key"; chmod 600 "$work/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$work/known_hosts"
options=(-i "$work/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known_hosts" -o ConnectTimeout=15)
if [[ "${1:-deploy}" == rollback ]]; then
 [[ "${2:-}" =~ ^[a-f0-9]{40}-[a-z0-9]+-[0-9]+$ ]] || exit 2
 ssh "${options[@]}" "root@$DEPLOY_HOST" "bash /opt/lab1/server-release.sh rollback '$2'"
else
 archive=${2:?需要发布包}; name=$(basename "$archive")
 [[ "$name" =~ ^release-[a-f0-9]{40}-[a-z0-9]+-[0-9]+\.tar\.gz$ ]] || exit 2
 ssh "${options[@]}" "root@$DEPLOY_HOST" 'mkdir -p /opt/lab1/incoming; chmod 700 /opt/lab1/incoming'
 scp "${options[@]}" "$archive" "$archive.sha256" scripts/server-release.sh "root@$DEPLOY_HOST:/opt/lab1/incoming/"
 ssh "${options[@]}" "root@$DEPLOY_HOST" "bash /opt/lab1/incoming/server-release.sh deploy '/opt/lab1/incoming/$name'"
fi
