#!/usr/bin/env bash
# First-install handoff of the verified existing owner/runtime to system services.
# Optional --migrate-pending performs a backed-up forward schema update first.
set -euo pipefail
[[ $EUID -eq 0 && -n ${SUDO_USER:-} && $SUDO_USER != root ]] || { echo 'Run with sudo from the existing runtime owner account.' >&2; exit 2; }
[[ $(cat /proc/1/comm) == systemd ]] || { echo 'Run on the actual Ubuntu host.' >&2; exit 2; }
migrate=0
case ${1:-} in '' ) ;; --migrate-pending) migrate=1 ;; *) echo 'Usage: sudo bash enable-realms-startup.sh [--migrate-pending]' >&2; exit 2;; esac
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
owner=$SUDO_USER
uid=$(id -u "$owner")
# Find exactly one existing postmaster owned by the invoking account.
projects=()
for pid in $(pgrep -u "$uid" -x postgres); do
  data=$(readlink "/proc/$pid/cwd" || true)
  [[ $data == */.state/postgres && -r $data/postmaster.pid ]] || continue
  read -r master_pid < "$data/postmaster.pid"
  [[ $master_pid == "$pid" ]] || continue
  projects+=("${data%/.state/postgres}")
done
[[ ${#projects[@]} -eq 1 ]] || { echo 'Could not identify exactly one existing runtime; no changes made.' >&2; exit 1; }
project=${projects[0]}
for f in /etc/systemd/system/kol-postgresql.service /etc/systemd/system/kol-realms.service /usr/local/lib/kol-infra/run-existing-realms.sh; do
  [[ ! -e $f && ! -L $f ]] || { echo 'Existing startup file found; stop and reconcile rather than overwrite.' >&2; exit 1; }
done
# Reject an unrelated API listener: the recorded original process must be this runtime.
read -r api_pid < "$project/.state/server.pid"
[[ $api_pid =~ ^[0-9]+$ && $(readlink "/proc/$api_pid/cwd") == "$project" && $(readlink "/proc/$api_pid/exe") == "$project/.local/node/bin/node" ]] || { echo 'Existing API identity differs; no changes made.' >&2; exit 1; }
umask 077
stage=$(mktemp -d /tmp/kol-startup.XXXXXXXX)
trap 'rm -rf -- "$stage"' EXIT
python3 "$source_dir/prepare-realms-services.py" --project-dir "$project" --user "$owner" --output-dir "$stage"
# Validate before service files are installed, using an executable staged entry point.
install -m 755 "$source_dir/run-existing-realms.sh" "$stage/run-existing-realms.sh"
sed "s|/usr/local/lib/kol-infra/run-existing-realms.sh|$stage/run-existing-realms.sh|g" "$stage/kol-postgresql.service" > "$stage/check-postgresql.service"
sed "s|/usr/local/lib/kol-infra/run-existing-realms.sh|$stage/run-existing-realms.sh|g; s|kol-postgresql.service|check-postgresql.service|g" "$stage/kol-realms.service" > "$stage/check-realms.service"
systemd-analyze verify "$stage/check-postgresql.service" "$stage/check-realms.service"
if ! curl --max-time 5 --fail --silent http://127.0.0.1:3000/health/ready >/dev/null; then
  ((migrate)) || { echo 'Game readiness failed. Forward migrations need a separate backed-up update; use --migrate-pending to include it.' >&2; exit 1; }
fi
# Every handoff has a fresh database dump. No initializer, seed or build is run.
backup_message=$(runuser -u "$owner" -- bash -ec 'cd "$1"; bash scripts/runtime.sh bash scripts/database.sh backup' _ "$project")
printf '%s\n' "$backup_message"
[[ $backup_message == "Backup created: "* ]] || { echo 'Unexpected backup output; stopping.' >&2; exit 1; }
backup=${backup_message#Backup created: }
# The project backup helper reports a path relative to its own working directory.
[[ $backup == /* ]] || backup="$project/$backup"
[[ -s $backup ]] || { echo 'No completed backup found; stopping.' >&2; exit 1; }
runuser -u "$owner" -- bash -ec 'cd "$1"; bash scripts/runtime.sh pg_restore --list "$2" >/dev/null' _ "$project" "$backup"
echo 'Backup archive created and readable (not a full restore test).'
if ((migrate)); then
  runuser -u "$owner" -- bash -ec 'cd "$1"; bash scripts/runtime.sh npm run db:migrate; bash scripts/runtime.sh npm run db:provision' _ "$project"
fi
curl --max-time 5 --fail --silent --show-error http://127.0.0.1:3000/health/ready >/dev/null
# Install without enabling; failures before handoff leave original processes running.
install -d -m 755 /usr/local/lib/kol-infra
install -m 755 "$source_dir/run-existing-realms.sh" /usr/local/lib/kol-infra/
install -m 644 "$stage/kol-postgresql.service" "$stage/kol-realms.service" /etc/systemd/system/
systemctl daemon-reload
handoff=0
recover() {
  local rc=$?
  trap - ERR
  echo 'Handoff failed; returning to the previous process model. Forward migrations, if applied, remain in place.' >&2
  systemctl disable --now kol-realms.service kol-postgresql.service || true
  rm -f /etc/systemd/system/kol-realms.service /etc/systemd/system/kol-postgresql.service
  systemctl daemon-reload
  if ((handoff)); then
    runuser -u "$owner" -- bash -ec 'cd "$1"; bash scripts/runtime.sh pg_ctl -D "$1/.state/postgres" -l "$1/.state/postgres.log" -w start' _ "$project" || true
    if ! curl --max-time 3 --fail --silent http://127.0.0.1:3000/health/live >/dev/null; then
      runuser -u "$owner" -- bash -c 'umask 077; setsid env REALMS_PROJECT_DIR="$1" bash "$2" api > "$1/.state/server.log" 2>&1 < /dev/null & printf "%s\n" "$!" > "$1/.state/server.pid"' _ "$project" "$source_dir/run-existing-realms.sh" || true
    fi
  fi
  rm -f /usr/local/lib/kol-infra/run-existing-realms.sh
  echo 'Verify application/database health; consult infra/docs/rollback.md and the fresh backup if recovery is incomplete.' >&2
  exit "$rc"
}
trap recover ERR
handoff=1
runuser -u "$owner" -- bash "$project/scripts/server.sh" stop
for attempt in {1..30}; do [[ ! -e /proc/$api_pid ]] && break; sleep 1; done
[[ ! -e /proc/$api_pid ]]
runuser -u "$owner" -- bash -ec 'cd "$1"; bash scripts/runtime.sh bash scripts/database.sh stop' _ "$project"
systemctl enable --now kol-postgresql.service
systemctl enable --now kol-realms.service
bash "$source_dir/validate-server.sh" kol-postgresql.service kol-realms.service
curl --max-time 5 --fail --silent --show-error http://127.0.0.1:3000/health/ready
trap - ERR
echo
 echo 'Desktop retained. Game and database are now boot-enabled system services. Reboot/logout acceptance still needs testing.'
