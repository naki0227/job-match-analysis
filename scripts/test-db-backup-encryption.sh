#!/bin/sh
set -eu

# Issue #31: the daily backup's format, end to end with dummy data. Dumps
# roles, schema and data as the backup workflow does, encrypts them with a
# throwaway age key, then restores into an empty PostgreSQL with
# scripts/backup/restore-backup.sh and checks FK, RLS and version history.
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

postgres_image="${JOB_MATCH_TEST_POSTGRES_IMAGE:-postgres:17.11-alpine3.24}"
source_container="job-match-backup-source-$$"
target_container="job-match-backup-target-$$"
target_port="${JOB_MATCH_BACKUP_TARGET_PORT:-55441}"
work=$(mktemp -d)

cleanup() {
  docker rm -f "$source_container" "$target_container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

docker run --rm -d --name "$source_container" \
  -e POSTGRES_PASSWORD=localtest "$postgres_image" >/dev/null
docker run --rm -d --name "$target_container" -p "127.0.0.1:$target_port:5432" \
  -e POSTGRES_PASSWORD=localtest "$postgres_image" >/dev/null

wait_for_postgres() {
  for _ in $(seq 1 30); do
    if docker exec "$1" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  printf 'PostgreSQL did not become ready: %s\n' "$1" >&2
  return 1
}

psql_in() {
  docker exec -i "$1" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
}

wait_for_postgres "$source_container"
wait_for_postgres "$target_container"

printf '%s\n' 'create schema auth; create table auth.users (id uuid primary key);' |
  psql_in "$source_container"
psql_in "$source_container" < supabase/tests/issue15_auth_fixture.sql
for migration in $(ls supabase/migrations/*.sql | sort); do
  psql_in "$source_container" < "$migration" >/dev/null
done
psql_in "$source_container" < supabase/tests/issue31_backup_fixture.sql

# The three parts of `supabase db dump` (--role-only, schema, --data-only).
# The superuser that every PostgreSQL already has is not part of a backup.
dump() {
  docker exec "$source_container" "$@" -U postgres
}
dump pg_dumpall --roles-only --no-role-passwords |
  grep -v -E '^(CREATE|ALTER) ROLE postgres( |;)' > "$work/roles.sql"
dump pg_dump -d postgres --schema-only --no-owner \
  --schema=auth --schema=public > "$work/schema.sql"
dump pg_dump -d postgres --data-only --no-owner \
  --schema=auth --schema=public > "$work/data.sql"

age-keygen --output "$work/key.txt" 2>/dev/null
recipient=$(age-keygen -y "$work/key.txt")
BACKUP_AGE_RECIPIENT="$recipient" \
  sh scripts/backup/encrypt-backup.sh "$work" "$work/backup.tar.age"
# Encrypted: the dummy data is in the dump but not readable in the artifact.
grep -q '00000000-0000-0000-0000-000000003101' "$work/data.sql"
if grep -aq -e '00000000-0000-0000-0000-000000003101' -e 'Dummy A' \
  "$work/backup.tar.age"; then
  printf '%s\n' 'Backup is not encrypted' >&2
  exit 1
fi

printf '%s\n' 'drop schema public cascade;' | psql_in "$target_container"
BACKUP_AGE_IDENTITY_FILE="$work/key.txt" \
  RESTORE_DB_URL="postgresql://postgres:localtest@127.0.0.1:$target_port/postgres" \
  sh scripts/backup/restore-backup.sh "$work/backup.tar.age" >/dev/null
psql_in "$target_container" < supabase/tests/issue31_restore_assert.sql

printf '%s\n' 'Issue #31 encrypted backup: dump, age encryption, checksum, restore, FK, RLS, and version-history checks passed'
