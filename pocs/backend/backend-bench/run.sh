#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

export COMPOSE_PROJECT_NAME=area-backend-bench
export JWT_SECRET="$(openssl rand -hex 32)"
export HOOK_SECRET="$(openssl rand -hex 32)"
export LARAVEL_APP_KEY="base64:$(openssl rand -base64 32)"

trap 'docker compose down -v --remove-orphans >/dev/null 2>&1' EXIT

npm install --no-audit --no-fund
docker build -q -t area-nestjs-poc ../nestJs-poc
docker build -q -t area-express-poc ../express-poc
docker build -q -t area-laravel-poc ../laravel-poc
docker compose up -d --wait postgres
node bench.mjs
