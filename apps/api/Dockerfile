# ---- Build ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter @ibirdos/api...
COPY apps/api ./apps/api
RUN pnpm --filter @ibirdos/db prisma:generate || true
RUN pnpm --filter @ibirdos/api build

# ---- Runtime ----
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && apk add --no-cache curl
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fs http://localhost:3001/api/v1/health/live || exit 1
CMD ["node", "apps/api/dist/main.js"]
