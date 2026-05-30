# IBirdOS V3 — AI-Native Catering ERP + Kitchen OS

Enterprise multi-tenant SaaS for restaurants, catering operations, and cloud kitchens. AI-driven invoice OCR, recipe costing, kitchen orchestration, vendor procurement intelligence, and operational insights.

## Architecture

Modular monorepo (Turborepo + pnpm):

```
apps/
  api/       NestJS REST API + Socket.IO realtime (ports 3001/3002)
  web/       Next.js 15 App Router (port 3000)
packages/
  db/        Prisma schema, migrations, tenant-scoping helper
  types/     Shared DTOs + the units engine (toCanonical, lineCost)
  permissions/  RBAC matrix (OWNER/MANAGER/CHEF/STAFF × ~80 perms)
  config/    Zod-validated env loader
  logger/    Pino logger with PII redaction
  ui/        Dark-luxury design system (CSS variables + components)
  ai/        OpenAI Vision + insight generation
k8s/         Kustomize manifests (base + prod/staging overlays)
```

## Core invariants

- **Ingredient is the single source of truth**: invoice → ingredient price → recipe cost → event margin → AI insight cascade.
- **Tenant isolation is absolute**: every query goes through `tenantScoped(prisma.model, ctx)`. The only raw `prisma.*` calls are in auth/admin paths.
- **Manager-creates-user**: no email-based onboarding. Workspace owners create staff accounts directly (@username + generated password).
- **All errors return the `ApiResponse` envelope** (`{ ok, data?, error? }`).
- **One design system, no inline hex**: all colors via Tailwind tokens.

## Quick start (local dev)

```bash
# Prerequisites: Node 20+, pnpm 9+, Docker
cp .env.example .env
docker compose up -d postgres redis minio
pnpm install
pnpm --filter @ibirdos/db run migrate dev
pnpm --filter @ibirdos/db run seed
pnpm dev     # starts api (3001), web (3000), workers
```

Visit http://localhost:3000.

## Tests

```bash
pnpm test               # unit tests (Vitest)
pnpm test:coverage      # with coverage report
pnpm test:e2e           # Playwright smoke tests
```

## Production deployment

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for full instructions. Quick view:

```bash
# Build images
docker build -t ghcr.io/ibirdos/api:v1.0.0 -f apps/api/Dockerfile .
docker build -t ghcr.io/ibirdos/web:v1.0.0 -f apps/web/Dockerfile .
docker build -t ghcr.io/ibirdos/workers:v1.0.0 -f apps/api/Dockerfile.worker .

# Deploy to k8s (after editing k8s/base/secret.yaml with real values)
kubectl apply -k k8s/overlays/prod
```

## What's inside

- **Phase 1-2** Foundation + auth: workspaces, memberships, sessions (sha256 token hash), argon2id passwords, RBAC, request brute-force protection via Redis.
- **Phase 3** Dark-luxury UI: tokens, components, sidebar with permission-gated nav.
- **Phase 4** Security: request ID, rate limiting, CSRF double-submit cookie, R2 presigned uploads, audit logging interceptor.
- **Phase 5-7** Ingredient + Invoice + Recipe AI: invoice OCR via OpenAI Vision (with deterministic dev fixture), ingredient matching (exact → pg_trgm fuzzy → AI), recipe auto-recosting on price change.
- **Phase 8** Inventory: append-only ledger, atomic transactions, low-stock alerts.
- **Phase 9-10** Events + Kitchen: catering events, kitchen packet generation (yield-aware aggregate), station-based task board.
- **Phase 11** Yield & Waste: EWMA-tracked yield observations refine default yields automatically.
- **Phase 12** Analytics: P&L, top recipes by margin, waste breakdown, price trends.
- **Phase 13** Customer Ordering: public menu, quote builder, Stripe checkout → auto-creates event.
- **Phase 14** Realtime: Socket.IO with JWT-validated handshake, Redis pub/sub bridge.
- **Phase 15** Vendor Integrations: CSV import, Sysco/USFoods/GFS adapters with OAuth flows.
- **Phase 16-17** Production hardening: health endpoints (k8s shape), graceful shutdown, Dockerfiles, CI workflow.
- **Production additions**: Stripe billing (real webhooks with signature verification, customer portal, seat-based pricing); AI Insights worker (daily detectors for price spikes, margin erosion, waste patterns, reorder needs); Notifications Center; OpenTelemetry + Sentry + Prometheus metrics; Testing infrastructure; K8s manifests; security hardening (Helmet headers, CSP, NetworkPolicy, non-root containers, read-only filesystems, PDBs, HPA).

## License

Proprietary. © IBirdOS.
