#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PWD/.local/node/bin:$PWD/.local/postgresql/usr/lib/postgresql/18/bin:$PATH"
export LD_LIBRARY_PATH="$PWD/.local/postgresql/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$@"
