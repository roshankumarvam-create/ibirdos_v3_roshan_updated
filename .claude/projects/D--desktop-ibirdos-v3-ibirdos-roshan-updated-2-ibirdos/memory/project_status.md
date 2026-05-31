---
name: ibirdos-project-status
description: IBirdOS V3 project status after comprehensive fix session on 2026-05-30
metadata:
  type: project
---

All major auth and domain bugs fixed on 2026-05-30. Project is now deploy-ready.

**Key bugs fixed:**
1. 10 files had circular `REDIS_CLIENT` imports from `../app.module` → fixed to `../common/constants/tokens`
2. New users created with `PENDING_PASSWORD_RESET` membership status → fixed to `ACTIVE`
3. BigInt serialization: Prisma returns BigInt for microcents fields; global `(BigInt.prototype as any).toJSON = function() { return Number(this); }` patch added to `apps/api/src/main.ts`
4. `updatePrice` method in ingredients.service.ts returned raw BigInt on early-return path
5. `pg_trgm` PostgreSQL extension was not enabled → enabled via `CREATE EXTENSION IF NOT EXISTS pg_trgm`
6. pnpm overrides were in `package.json` (deprecated) → moved to `pnpm-workspace.yaml`
7. Dockerfiles missing `pnpm-lock.yaml` in COPY → added
8. `.env.example` missing several env vars → added all config vars

**Why:** Root cause of user's auth failure was the circular import making REDIS_CLIENT undefined in NestJS DI, causing the entire API to fail to start.

**How to apply:** When debugging auth or DI issues, check for circular imports first. Always ensure BigInt fields are serialized to Number before returning from controllers.
