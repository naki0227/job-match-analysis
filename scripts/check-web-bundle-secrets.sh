#!/bin/sh
# Issue #29: fail if the built Web bundle contains server-only secrets.
# supabase-js ships the bare "sb_secret_" prefix, so only key-shaped values
# and server variable names count as leaks.
set -eu

dist="${1:-apps/web/dist}"
if [ ! -d "$dist" ]; then
  printf 'Web build output not found: %s\n' "$dist" >&2
  exit 1
fi

if grep -rEl 'sb_secret_[A-Za-z0-9_-]{8,}|SUPABASE_SECRET_KEY|JEV_API_KEY' "$dist"; then
  printf '%s\n' 'Server-only secret or variable name found in the Web bundle' >&2
  exit 1
fi

for name in SUPABASE_SECRET_KEY JEV_API_KEY; do
  value=$(printenv "$name" || true)
  if [ -n "$value" ] && grep -rFl -- "$value" "$dist"; then
    printf '%s value found in the Web bundle\n' "$name" >&2
    exit 1
  fi
done

printf '%s\n' 'Web bundle contains no server-only secrets'
