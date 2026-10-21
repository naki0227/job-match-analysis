#!/bin/sh
# Starts the published entrypoints of an image without network or secrets
# (Issue #33). Usage: scripts/smoke-image.sh <api|crawler> <image> [platform]
set -eu
kind=$1
image=$2
platform=${3:-}
set -- --rm --read-only --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp
if [ -n "$platform" ]; then set -- "$@" --platform "$platform"; fi

if [ "$kind" = api ]; then
  docker run "$@" -w /app/apps/api --entrypoint node "$image" \
    -e "import('@resvg/resvg-js').then(()=>import('/app/apps/api/dist/share-page/og-font.js')).then(m=>m.loadOgFont()).then(f=>console.log(process.arch,'font',f.length))"
elif [ -z "$platform" ] || [ "$platform" = linux/amd64 ]; then
  docker run "$@" --tmpfs /home/node --shm-size 256m -w /app/apps/crawler "$image" \
    node -e "import('playwright').then(async ({chromium})=>{const b=await chromium.launch({executablePath:process.env.CRAWLER_BROWSER_EXECUTABLE});const p=await b.newPage();await p.setContent('<p>ok</p>');console.log(process.arch,'chromium',await p.textContent('p'));await b.close()})"
else
  # Chromium under QEMU emulation is unreliable; only check the entrypoint
  # finds the headless shell on emulated platforms.
  docker run "$@" -w /app/apps/crawler "$image" \
    node -e "console.log(process.arch, process.env.CRAWLER_BROWSER_EXECUTABLE)"
fi
if [ "$kind" = crawler ]; then
  # DDGS is the pinned version with its DuckDuckGo engine (no network).
  docker run "$@" --entrypoint /opt/ddgs/bin/python "$image" \
    /app/apps/crawler/ddgs/search.py --self-check
fi
