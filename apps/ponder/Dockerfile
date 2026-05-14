# syntax=docker/dockerfile:1.7

FROM node:24-slim

WORKDIR /app

ENV NO_COLOR=1

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/ponder/package.json apps/ponder/package.json
COPY packages/repair-db/package.json packages/repair-db/package.json

RUN pnpm install --frozen-lockfile --filter @filoz/repair-ponder...

COPY apps/ponder apps/ponder
COPY packages/repair-db packages/repair-db

RUN pnpm --filter @filoz/repair-db build
RUN chown -R node:node /app

USER node
WORKDIR /app/apps/ponder

ENTRYPOINT ["./node_modules/.bin/ponder"]
CMD ["start"]
