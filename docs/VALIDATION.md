# IBirdOS V3 — Validation Status

This document records what was verified by actually compiling/running the code
(not just file presence), and the one environment limitation.

## Verified green

- **All 7 shared packages typecheck** under `strict` + `exactOptionalPropertyTypes`:
  `types`, `permissions`, `config`, `logger`, `ai`, `ui` (and `db` modulo the
  generated Prisma client — see below).
- **Web app (`apps/web`) typechecks clean** (`tsc --noEmit`) — all dashboard
  pages, hooks, charts, and the API client.
- **Unit tests pass: 42/42** (`pnpm test`):
  - `packages/types/__tests__/units.test.ts` — 29 tests pinning the unit
    conversion engine (mass/volume/count, density bridging, aliases, cost math).
  - `packages/permissions/__tests__/rbac.test.ts` — 13 tests pinning the
    role→permission matrix boundaries.
- **API (`apps/api`) typechecks clean** against a permissive `@prisma/client`
  type stub. The only residual diagnostics are three *stub artifacts* that
  resolve under the real generated client (a `$transaction([...])` tuple
  inference and a `Map<string, number>` value type). They are not code defects.

## Bugs found and fixed during this validation pass

Real compile/runtime bugs surfaced by actually building (all fixed):

1. `packages/types` — duplicate `UnitDimension` export (barrel ambiguity).
2. `packages/logger` — pino `transport: undefined` rejected under
   `exactOptionalPropertyTypes`; now attached conditionally.
3. `packages/ui` — tsconfig missing `jsx`/DOM lib.
4. `apps/web/src/lib/api.ts` — `fetch` body `undefined` under
   `exactOptionalPropertyTypes`; init built conditionally.
5. `apps/web/src/lib/api-client.ts` — dead duplicate client removed
   (0 imports; canonical client is `api.ts`).
6. `apps/api/src/main.ts` — top-level `await` under commonjs; changed to
   fire-and-forget `void initTracing()`.
7. `packages/config/src/env.ts` — `SYSCO_*`/`USFOODS_*` vars were referenced
   by the vendor adapters but never added to the schema; added.
8. `packages/ai/src/index.ts` — `./insights` not exported, breaking the
   insights worker's `narrateInsight` import; exported.
9. `packages/ai/src/insights.ts` — referenced `OPENAI_INSIGHTS_MODEL`
   (nonexistent); aligned to `AI_INSIGHTS_MODEL`.
10. `ingredients.service.addAlias` — source union too narrow; widened to match
    the `AliasSource` Prisma enum (`VENDOR_CATALOG`, `AI_MATCH`).
11. `auth.service.ts` — hacky inline `require("@nestjs/common").Inject`
    decorator replaced with a proper `@Inject` import.
12. `users.service.ts` — dead-code role comparison no-overlap error; cast.
13. `password.service.ts` — `type` not allowed in `argon2.needsRehash` options
    in the installed version; removed.
14. **ioredis duplication** (5.10.1 vs 5.11.0) caused BullMQ
    `ConnectionOptions` type-identity errors across all workers; fixed with a
    pnpm `overrides` entry pinning ioredis to 5.10.1 (matches bullmq).
15. `recipe-recost.worker.ts` — `new Set(any)` widened to `Set<unknown>`;
    made explicit `Set<string>` with a type guard.

## One environment limitation

`prisma generate` cannot run in the build sandbox because the Prisma engine
binary CDN (`binaries.prisma.sh`) is outside the network allowlist. This blocks:

- generating `@prisma/client` (so `apps/api` was typechecked against a stub),
- running the `tenant-scoped` integration test (it instantiates `PrismaClient`).

Both work normally in any environment with network access. CI runs
`prisma generate` before typecheck/test (see `.github/workflows/ci.yml`), and
the Dockerfiles run it during the build stage. To validate locally:

```bash
pnpm install
pnpm --filter @ibirdos/db exec prisma generate
pnpm typecheck   # full repo, including apps/api with real client types
pnpm test        # includes the tenant-isolation integration test
```
