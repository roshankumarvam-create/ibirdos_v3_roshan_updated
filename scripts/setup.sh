#!/usr/bin/env bash
# IBirdOS V3 — one-command local setup
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "→ Checking prerequisites..."
command -v node    >/dev/null || { echo "Node 20+ required"; exit 1; }
command -v pnpm    >/dev/null || { echo "pnpm 9+ required (npm install -g pnpm)"; exit 1; }
command -v docker  >/dev/null || { echo "Docker required for postgres/redis/minio"; exit 1; }

if [ ! -f .env ]; then
  echo "→ Creating .env from .env.example"
  cp .env.example .env
  # Generate a real AUTH_SECRET so the app actually boots
  SECRET=$(openssl rand -base64 32 | tr -d '\n')
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^AUTH_SECRET=.*|AUTH_SECRET=${SECRET}|" .env
  else
    sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=${SECRET}|" .env
  fi
  echo "  ✓ AUTH_SECRET generated"
fi

echo "→ Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "→ Starting infrastructure (Postgres, Redis, MinIO)..."
docker compose up -d

echo "→ Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U ibirdos >/dev/null 2>&1; do
  sleep 1
done

echo "→ Generating Prisma client and running migrations..."
pnpm db:generate
pnpm db:migrate || pnpm --filter @ibirdos/db exec prisma migrate dev --name init

echo ""
echo "✓ Setup complete."
echo ""
echo "  Next: pnpm dev                  # starts web + api"
echo "        pnpm db:studio            # open Prisma Studio"
echo "        docker compose logs -f    # tail infra logs"
