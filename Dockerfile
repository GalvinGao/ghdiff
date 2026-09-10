# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm \
    PNPM_CONFIG_IGNORE_SCRIPTS=true
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:node

FROM node:24-alpine
WORKDIR /app
RUN chown node:node /app
USER node
COPY --from=build --chown=node:node /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
