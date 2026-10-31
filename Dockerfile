FROM node:24-slim AS base

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/eshop/package.json packages/eshop/package.json
COPY packages/shared/package.json packages/shared/package.json

FROM base AS prod-deps

RUN pnpm install --prod --frozen-lockfile

FROM base AS build

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/web apps/web
COPY apps/worker apps/worker
COPY packages/database packages/database
COPY packages/eshop packages/eshop
COPY packages/shared packages/shared

RUN pnpm run build

FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/apps/api/package.json apps/api/package.json
COPY --chown=node:node --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY --chown=node:node --from=build /app/apps/api/dist apps/api/dist
COPY --chown=node:node --from=build /app/apps/web/dist apps/web/dist
COPY --chown=node:node --from=build /app/apps/worker/package.json apps/worker/package.json
COPY --chown=node:node --from=prod-deps /app/apps/worker/node_modules apps/worker/node_modules
COPY --chown=node:node --from=build /app/apps/worker/dist apps/worker/dist
COPY --chown=node:node --from=build /app/packages/database/package.json packages/database/package.json
COPY --chown=node:node --from=prod-deps /app/packages/database/node_modules packages/database/node_modules
COPY --chown=node:node --from=build /app/packages/database/dist packages/database/dist
COPY --chown=node:node --from=build /app/packages/eshop/package.json packages/eshop/package.json
COPY --chown=node:node --from=prod-deps /app/packages/eshop/node_modules packages/eshop/node_modules
COPY --chown=node:node --from=build /app/packages/eshop/dist packages/eshop/dist
COPY --chown=node:node --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --chown=node:node --from=prod-deps /app/packages/shared/node_modules packages/shared/node_modules
COPY --chown=node:node --from=build /app/packages/shared/dist packages/shared/dist

USER node
CMD ["node", "apps/worker/dist/main.js", "schedule"]
