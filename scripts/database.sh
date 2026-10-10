#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/.local/node/bin:$PWD/.local/postgresql/usr/lib/postgresql/18/bin:$PATH"
export LD_LIBRARY_PATH="$PWD/.local/postgresql/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
task_operation=${1:-status}
case "$task_operation" in
  start)
    node scripts/configure.mjs
    if [[ ! -f .state/postgres/PG_VERSION ]]; then
      initdb -D "$PWD/.state/postgres" -L "$PWD/.local/postgresql/usr/share/postgresql/18" -U realms --pwfile="$PWD/.state/db-password" --auth-local=scram-sha-256 --auth-host=scram-sha-256 --encoding=UTF8 --locale=C
      printf "\nlisten_addresses = '127.0.0.1'\nport = 55432\nunix_socket_directories = ''\nshared_buffers = '128MB'\nmax_connections = 30\nmax_locks_per_transaction = 512\n" >> .state/postgres/postgresql.conf
    fi
    if ! pg_ctl -D "$PWD/.state/postgres" status >/dev/null 2>&1; then pg_ctl -D "$PWD/.state/postgres" -l "$PWD/.state/postgres.log" -w start; fi
    export PGPASSWORD
    PGPASSWORD=$(cat .state/db-password)
    for task_database in realms_dev realms_test; do
      if [[ $(psql -h 127.0.0.1 -p 55432 -U realms -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$task_database'") != 1 ]]; then
        createdb -h 127.0.0.1 -p 55432 -U realms "$task_database"
      fi
    done
    ;;
  stop) pg_ctl -D "$PWD/.state/postgres" -m fast -w stop ;;
  status) pg_ctl -D "$PWD/.state/postgres" status ;;
  backup)
    umask 077
    mkdir -p .state/backups
    export PGPASSWORD
    PGPASSWORD=$(cat .state/db-password)
    task_backup=".state/backups/realms_dev-$(date -u +%Y%m%dT%H%M%SZ).dump"
    pg_dump -h 127.0.0.1 -p 55432 -U realms -Fc -f "$task_backup" realms_dev
    printf 'Backup created: %s\n' "$task_backup"
    ;;
  restore-check)
    task_backup=${2:?Provide a backup path}
    [[ -f "$task_backup" ]] || { printf 'Backup does not exist.\n' >&2; exit 2; }
    export PGPASSWORD
    PGPASSWORD=$(cat .state/db-password)
    task_suffix=$(node -e "process.stdout.write(require('node:crypto').randomBytes(8).toString('hex'))")
    task_restore="realms_restore_$task_suffix"
    createdb -h 127.0.0.1 -p 55432 -U realms "$task_restore"
    trap 'dropdb -h 127.0.0.1 -p 55432 -U realms "$task_restore"' EXIT
    pg_restore --exit-on-error --no-owner --no-privileges -h 127.0.0.1 -p 55432 -U realms -d "$task_restore" "$task_backup"
    export RESTORE_DATABASE_URL="postgresql://realms:$PGPASSWORD@127.0.0.1:55432/$task_restore"
    node --import tsx src/restore-check.ts
    ;;
  *) printf 'Usage: bash scripts/database.sh start|stop|status|backup|restore-check BACKUP\n' >&2; exit 2 ;;
esac
