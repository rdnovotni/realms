#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_operation=${1:-status}
case "$task_operation" in
  start)
    node_pid_file=.state/server.pid
    if [[ -f "$node_pid_file" ]] && kill -0 "$(cat "$node_pid_file")" 2>/dev/null; then printf 'Server already running.\n'; exit 0; fi
    bash scripts/database.sh start
    bash scripts/runtime.sh npm run db:migrate
    bash scripts/runtime.sh npm run db:seed
    bash scripts/runtime.sh npm run db:provision
    bash scripts/runtime.sh npm run build
    bash scripts/runtime.sh node scripts/runtime-config.mjs
    setsid env -u DATABASE_ADMIN_URL -u TEST_DATABASE_URL -u TEST_DATABASE_ADMIN_URL -u DATABASE_URL -u HOST -u PORT -u AUTH_MODE -u DEV_API_TOKEN -u DEV_ACCOUNT_ID -u AUTH_THROTTLE_KEY bash scripts/runtime.sh node --env-file=.state/runtime.env dist/main.js > .state/server.log 2>&1 < /dev/null &
    task_pid=$!
    printf '%s\n' "$task_pid" > "$node_pid_file"
    for task_attempt in {1..30}; do
      if curl --fail --silent http://127.0.0.1:3000/health/ready >/dev/null; then printf 'Realms ready at http://127.0.0.1:3000\n'; exit 0; fi
      if ! kill -0 "$task_pid" 2>/dev/null; then printf 'Server exited; see .state/server.log.\n' >&2; exit 1; fi
      sleep 0.2
    done
    printf 'Readiness timed out; see .state/server.log.\n' >&2; exit 1
    ;;
  stop)
    if [[ -f .state/server.pid ]]; then
      task_pid=$(cat .state/server.pid)
      # Do not signal an unrelated process after PID reuse.
      if [[ -r /proc/$task_pid/cmdline ]] && tr '\0' ' ' < "/proc/$task_pid/cmdline" | grep -Eq 'node --env-file=(\.env|\.state/runtime\.env) dist/main.js'; then kill "$task_pid"; fi
      rm .state/server.pid
    fi
    ;;
  status) curl --fail --silent --show-error http://127.0.0.1:3000/health/ready; printf '\n' ;;
  *) printf 'Usage: bash scripts/server.sh start|stop|status\n' >&2; exit 2 ;;
esac
