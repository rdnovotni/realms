#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local/downloads .local/postgresql
if [[ ! -x .local/node/bin/node ]]; then
  task_archive=node-v24.21.0-linux-x64.tar.xz
  curl --fail --location --silent --show-error "https://nodejs.org/dist/v24.21.0/$task_archive" -o ".local/downloads/$task_archive"
  curl --fail --location --silent --show-error https://nodejs.org/dist/v24.21.0/SHASUMS256.txt -o .local/downloads/SHASUMS256.txt
  (cd .local/downloads; awk -v archive="$task_archive" '$2 == archive' SHASUMS256.txt > node-checksum.txt; test -s node-checksum.txt; sha256sum --check node-checksum.txt)
  tar -xJf ".local/downloads/$task_archive" -C .local
  mv .local/node-v24.21.0-linux-x64 .local/node
fi
if [[ ! -x .local/postgresql/usr/lib/postgresql/18/bin/postgres ]]; then
  # Downloads use authenticated Ubuntu package metadata; no system installation.
  (cd .local/downloads; apt-get download postgresql-18 postgresql-client-18 libpq5 libldap2 libnuma1 liburing2)
  for task_deb in .local/downloads/*.deb; do dpkg-deb --extract "$task_deb" .local/postgresql; done
fi
export PATH="$PWD/.local/node/bin:$PATH"
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
printf 'Local Node.js and PostgreSQL tools installed.\n'
