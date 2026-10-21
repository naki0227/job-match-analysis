#!/bin/sh
# Verifies a built image runs as a non-root user and carries no secret-like
# environment variables or .env files (Issue #33).
# Usage: scripts/check-image.sh <image> [platform]
set -eu
image=$1
platform=${2:-}
set -- --rm
if [ -n "$platform" ]; then set -- "$@" --platform "$platform"; fi

user=$(docker image inspect --format '{{.Config.User}}' "$image")
case "$user" in
  "" | root | 0 | 0:*) echo "$image runs as root" >&2; exit 1 ;;
esac

if docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" \
  | cut -d= -f1 | grep -Eiq 'secret|token|password|passwd|api_?key|private'; then
  echo "$image bakes a secret-like environment variable" >&2
  exit 1
fi

found=$(docker run "$@" --entrypoint sh "$image" -c \
  'find / -xdev \( -name ".env" -o -name ".env.*" \) ! -name "*.example" ! -name "*.sample" 2>/dev/null || true')
if [ -n "$found" ]; then
  echo "$image contains env files:" >&2
  echo "$found" >&2
  exit 1
fi

echo "$image: user=$user, no baked secrets"
