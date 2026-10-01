FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/crawler/package.json ./apps/crawler/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/domain/package.json ./packages/domain/

RUN pnpm install --frozen-lockfile --filter crawler...

COPY packages/contracts/ ./packages/contracts/
RUN pnpm --filter @job-match/contracts build

COPY packages/domain/ ./packages/domain/
RUN pnpm --filter @job-match/domain build

COPY apps/crawler/ ./apps/crawler/

RUN pnpm --filter crawler build

RUN pnpm --filter crawler deploy --prod --legacy /app/deploy

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CRAWLER_DDGS_PYTHON=/opt/ddgs/bin/python \
    CRAWLER_DDGS_SCRIPT=/app/apps/crawler/ddgs/search.py

# Web discovery search (ADR-047): DDGS pinned in its own virtualenv, used only
# by the worker through apps/crawler/ddgs/search.py.
COPY apps/crawler/ddgs/ ./apps/crawler/ddgs/
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/ddgs \
    && /opt/ddgs/bin/pip install --no-cache-dir -r apps/crawler/ddgs/requirements.txt \
    && /opt/ddgs/bin/python apps/crawler/ddgs/search.py --self-check \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/deploy/node_modules ./apps/crawler/node_modules
COPY --from=build /app/apps/crawler/dist ./apps/crawler/dist/
COPY --from=build /app/apps/crawler/package.json ./apps/crawler/package.json
COPY apps/crawler/docker-entrypoint.sh /usr/local/bin/crawler-entrypoint

# Headless Chromium shell for the Playwright fallback only (no headed browser,
# no ffmpeg); the version follows the lockfile.
RUN node apps/crawler/node_modules/playwright/cli.js install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*

USER node

ENTRYPOINT ["crawler-entrypoint"]
CMD ["node", "apps/crawler/dist/worker-main.js"]
