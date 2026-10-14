#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 ../infra/scripts/feature_registry.py
bash scripts/runtime.sh npm run typecheck
bash scripts/runtime.sh npm test
bash scripts/runtime.sh npm run test:integration
bash scripts/runtime.sh npm run test:workers
bash scripts/runtime.sh npm run test:runtime
bash scripts/runtime.sh npm run build
