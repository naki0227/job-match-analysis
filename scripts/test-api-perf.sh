#!/bin/sh
set -eu

# Issue #30: API latency against a disposable PostgreSQL with seeded data.
# No Supabase project, crawler, Jev or external site is called.
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

container_name="job-match-perf-$$"
postgres_image="${JOB_MATCH_TEST_POSTGRES_IMAGE:-postgres:17.11-alpine3.24}"
port="${JOB_MATCH_PERF_PORT:-55439}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm -d --name "$container_name" -p "127.0.0.1:$port:5432" \
  -e POSTGRES_PASSWORD=localtest "$postgres_image" >/dev/null

ready=false
for _ in $(seq 1 30); do
  if docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  printf '%s\n' 'PostgreSQL did not become ready' >&2
  exit 1
fi

psql_cmd() {
  docker exec -i "$container_name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

psql_cmd -c 'create schema auth; create table auth.users (id uuid primary key);'
psql_cmd < supabase/tests/issue15_auth_fixture.sql
for migration in $(ls supabase/migrations/*.sql | sort); do
  psql_cmd < "$migration" >/dev/null
done
psql_cmd < supabase/tests/perf_seed.sql

PERF_DATABASE_URL="postgresql://postgres:localtest@127.0.0.1:$port/postgres" \
  pnpm --filter api exec node --import tsx scripts/perf/run-perf.ts
