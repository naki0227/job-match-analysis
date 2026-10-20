#!/bin/sh
set -eu

# Restores an encrypted backup made by encrypt-backup.sh into an EMPTY
# database (a new Supabase project, never the one in use). The order and
# flags follow Supabase's backup/restore guide: roles, schema, then data
# with triggers off, all in one transaction (#31).
# Usage: BACKUP_AGE_IDENTITY_FILE=key.txt RESTORE_DB_URL=postgresql://... \
#   restore-backup.sh <backup.tar.age>
input=$1
identity="${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required}"
target="${RESTORE_DB_URL:?RESTORE_DB_URL is required}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

age --decrypt --identity "$identity" --output "$work/backup.tar" "$input"
tar -C "$work" -xf "$work/backup.tar"
(cd "$work" && sha256sum --check --quiet SHA256SUMS)

psql "$target" --single-transaction --no-psqlrc \
  --variable ON_ERROR_STOP=1 \
  --file "$work/roles.sql" \
  --file "$work/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$work/data.sql"
