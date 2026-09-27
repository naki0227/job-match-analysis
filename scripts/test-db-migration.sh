#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

container_name="job-match-issue14-$$"
postgres_image="${JOB_MATCH_TEST_POSTGRES_IMAGE:-postgres:17.11-alpine3.24}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm -d --name "$container_name" \
  -e POSTGRES_PASSWORD=localtest "$postgres_image" >/dev/null

ready=false
for _ in $(seq 1 30); do
  if docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then
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
psql_cmd < supabase/migrations/20260927000100_core_schema.sql
psql_cmd < supabase/migrations/20260927000200_evaluation_match_schema.sql
psql_cmd < supabase/tests/issue14_integrity.sql
psql_cmd < supabase/rollback/20260927_issue14_down.sql

remaining=$(psql_cmd -Atc "select count(*) from pg_tables where schemaname = 'public'")
if [ "$remaining" != 0 ]; then
  printf 'Rollback left %s public tables\n' "$remaining" >&2
  exit 1
fi

printf '%s\n' 'Issue #14 migration, integrity, RLS, and rollback checks passed'
