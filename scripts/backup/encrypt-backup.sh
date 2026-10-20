#!/bin/sh
set -eu

# Packs a backup directory (roles.sql, schema.sql, data.sql) with a SHA-256
# manifest and encrypts it to an age public key (BACKUP_AGE_RECIPIENT).
# Only the holder of the matching private key can read it (#31).
# Usage: encrypt-backup.sh <backup-dir> <output.tar.age>
dir=$1
output=$2
recipient="${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"

for part in roles.sql schema.sql data.sql; do
  if [ ! -s "$dir/$part" ]; then
    printf 'Backup part is missing or empty: %s\n' "$part" >&2
    exit 1
  fi
done

(cd "$dir" && sha256sum roles.sql schema.sql data.sql > SHA256SUMS)
tar -C "$dir" -cf - SHA256SUMS roles.sql schema.sql data.sql |
  age --encrypt --recipient "$recipient" --output "$output"
test -s "$output"
