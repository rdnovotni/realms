#!/usr/bin/env bash
set -euo pipefail
exec /usr/bin/python3 "$(dirname -- "${BASH_SOURCE[0]}")/../control_panel/app.py" "$@"
