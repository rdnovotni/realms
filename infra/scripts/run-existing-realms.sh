#!/usr/bin/env bash
# Root-owned systemd entry point; executes an existing, prebuilt runtime as service User.
set -euo pipefail
cd -- "${REALMS_PROJECT_DIR:?Set REALMS_PROJECT_DIR in the system unit}"
export PATH="$PWD/.local/node/bin:$PWD/.local/postgresql/usr/lib/postgresql/18/bin:/usr/bin:/bin"
export LD_LIBRARY_PATH="$PWD/.local/postgresql/usr/lib/x86_64-linux-gnu"
case "${1:-}" in
  db) exec .local/postgresql/usr/lib/postgresql/18/bin/postgres -D "$PWD/.state/postgres" ;;
  api)
    # Match the existing server's restricted runtime credential boundary.
    unset DATABASE_ADMIN_URL TEST_DATABASE_URL TEST_DATABASE_ADMIN_URL DATABASE_URL HOST PORT AUTH_MODE DEV_API_TOKEN DEV_ACCOUNT_ID AUTH_THROTTLE_KEY
    exec .local/node/bin/node --env-file=.state/runtime.env dist/main.js ;;
  db-ready|api-ready)
    for attempt in {1..60}; do
      if [[ "$1" == db-ready ]]; then
        if .local/postgresql/usr/lib/postgresql/18/bin/pg_isready -h 127.0.0.1 -p 55432 >/dev/null; then exit 0; fi
      elif curl --max-time 2 --fail --silent http://127.0.0.1:3000/health/ready >/dev/null; then exit 0
      fi
      sleep 1
    done
    printf 'Existing runtime did not become ready.\n' >&2; exit 1 ;;
  *) printf 'Usage: run-existing-realms.sh db|api|db-ready|api-ready\n' >&2; exit 2 ;;
esac
