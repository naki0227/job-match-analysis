FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/domain/package.json ./packages/domain/
COPY packages/application/package.json ./packages/application/

RUN pnpm install --frozen-lockfile --filter api...

COPY packages/contracts/ ./packages/contracts/
RUN pnpm --filter @job-match/contracts build

COPY packages/domain/ ./packages/domain/
RUN pnpm --filter @job-match/domain build

COPY packages/application/ ./packages/application/
RUN pnpm --filter @job-match/application build

COPY apps/api/ ./apps/api/

RUN pnpm --filter api build

RUN pnpm --filter api deploy --prod --legacy /app/deploy

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /app/apps/api/dist ./apps/api/dist/
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
# OG image font (SIL OFL 1.1, license kept alongside); never served over HTTP.
COPY --from=build /app/apps/api/assets ./apps/api/assets

COPY --from=build /app/deploy/node_modules ./apps/api/node_modules

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
