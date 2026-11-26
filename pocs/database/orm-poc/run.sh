#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

export COMPOSE_PROJECT_NAME=area-orm-benchmark
trap 'docker compose down -v >/dev/null 2>&1' EXIT

npm install --no-audit --no-fund
docker compose up -d --wait postgres
npm run build
node dist/bench.js
