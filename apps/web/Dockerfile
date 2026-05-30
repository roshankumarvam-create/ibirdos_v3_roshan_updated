FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @ibirdos/web...
COPY apps/web ./apps/web
RUN pnpm --filter @ibirdos/web build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable && apk add --no-cache curl
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fs http://localhost:3000/ || exit 1
CMD ["pnpm", "--filter", "@ibirdos/web", "start"]
