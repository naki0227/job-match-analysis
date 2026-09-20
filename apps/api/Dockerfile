FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter api...

COPY apps/api/ ./apps/api/

RUN pnpm --filter api build

RUN pnpm --filter api deploy --prod --legacy /app/deploy

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /app/apps/api/dist ./apps/api/dist/
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

COPY --from=build /app/deploy/node_modules ./apps/api/node_modules

ENV NODE_ENV=production

USER node

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]