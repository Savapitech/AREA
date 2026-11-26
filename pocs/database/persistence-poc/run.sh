#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export COMPOSE_PROJECT_NAME=area-persistence-benchmark
trap 'docker compose down -v' EXIT
npm install --no-audit --no-fund
rm -f results.json
node checks.js defaults
for db in postgres mariadb mongodb; do
  docker compose up -d "$db"
  if [[ "$db" == mongodb ]]; then
    for i in {1..60}; do
      if docker compose exec -T mongodb mongosh --quiet --eval 'try { rs.status().ok } catch(e) { rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]}) }' >/dev/null 2>&1; then break; fi
      sleep 2
    done
  fi
  node benchmark.js "$db"
  node checks.js "$db"
  docker compose down -v
done
node benchmark.js report
node report.js
