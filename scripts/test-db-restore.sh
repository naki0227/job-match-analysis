#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

postgres_image="${JOB_MATCH_TEST_POSTGRES_IMAGE:-postgres:17.11-alpine3.24}"
source_container="job-match-restore-source-$$"
target_container="job-match-restore-target-$$"
dump_file=$(mktemp)

cleanup() {
  docker rm -f "$source_container" "$target_container" >/dev/null 2>&1 || true
  rm -f "$dump_file"
}
trap cleanup EXIT INT TERM

docker run --rm -d --name "$source_container" \
  -e POSTGRES_PASSWORD=localtest "$postgres_image" >/dev/null
docker run --rm -d --name "$target_container" \
  -e POSTGRES_PASSWORD=localtest "$postgres_image" >/dev/null

wait_for_postgres() {
  container=$1
  for _ in $(seq 1 30); do
    # The image's temporary init server accepts sockets before the final TCP server starts.
    if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  printf 'PostgreSQL did not become ready: %s\n' "$container" >&2
  return 1
}

psql_in() {
  docker exec -i "$1" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
}

wait_for_postgres "$source_container"
wait_for_postgres "$target_container"

printf '%s\n' 'create schema auth; create table auth.users (id uuid primary key);' |
  psql_in "$source_container"
for migration in supabase/migrations/*.sql; do
  case "$migration" in
    *personal_read_rls.sql)
      psql_in "$source_container" < supabase/tests/issue15_auth_fixture.sql ;;
  esac
  psql_in "$source_container" < "$migration"
done
psql_in "$source_container" < supabase/tests/issue31_backup_fixture.sql

docker exec "$source_container" pg_dump -U postgres -d postgres \
  --format=custom --schema=auth --schema=public > "$dump_file"
test -s "$dump_file"

printf '%s\n' \
  'create role anon nologin;' \
  'create role authenticated nologin;' \
  'create role service_role nologin bypassrls;' \
  'drop schema public cascade;' | psql_in "$target_container"
docker exec -i "$target_container" pg_restore -U postgres -d postgres \
  --no-owner --exit-on-error < "$dump_file"
psql_in "$target_container" < supabase/tests/issue31_restore_assert.sql

printf '%s\n' 'Issue #31 dummy-data dump/restore, FK, RLS, and version-history checks passed'
