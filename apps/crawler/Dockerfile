FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/crawler/package.json ./apps/crawler/

RUN pnpm install --frozen-lockfile --filter crawler...

COPY apps/crawler/ ./apps/crawler/

RUN pnpm --filter crawler build

RUN pnpm --filter crawler deploy --prod --legacy /app/deploy

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

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
