#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/runtime.sh npm run typecheck
bash scripts/runtime.sh npm test
bash scripts/runtime.sh npm run test:integration
bash scripts/runtime.sh npm run build
