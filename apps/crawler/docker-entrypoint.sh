#!/bin/sh
set -eu
# Use the headless shell installed by Playwright in the image unless overridden.
if [ -z "${CRAWLER_BROWSER_EXECUTABLE:-}" ]; then
  CRAWLER_BROWSER_EXECUTABLE=$(find "${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}" -type f -name chrome-headless-shell -perm -u+x | head -n 1)
  if [ -z "$CRAWLER_BROWSER_EXECUTABLE" ]; then
    echo "Headless Chromium not found" >&2
    exit 1
  fi
  export CRAWLER_BROWSER_EXECUTABLE
fi
exec "$@"
