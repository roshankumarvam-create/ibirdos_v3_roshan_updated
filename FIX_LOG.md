# Fix Log — Client Bug-Fix Batch (2026-07-20 →)

Format per issue: Root cause → Fix → Files changed → Commit → Verification status.

---

## P0-1: Chef/Staff server-side authorization

**Status:** IN PROGRESS — investigation phase.

### Step 1 — Deployed-vs-repo commit check

- Local `git rev-parse HEAD`: `f1b382231be4a588c3b24819f9ab908efd471ed3`
- Railway API service (`301efcf6-fe1b-416b-8b1f-a752918e7ac2`) live deployment, via `railway status --json`:
  - `commitHash: f1b382231be4a588c3b24819f9ab908efd471ed3` (exact match)
  - `branch: master`, `commitAuthor: roshankumarvam-create`
  - `commitMessage` matches local HEAD's commit message verbatim
- **Conclusion: no drift on the Railway/API side.** The deployed backend is running the current repo's code exactly.
- **Gap flagged, not resolved:** could not verify the Vercel-deployed web commit — no non-interactive Vercel access available in this session. If Chef's browser session is loading a stale web bundle, that can't be ruled out from here. Recommend checking the Vercel dashboard's "Current Deployment" commit hash against `f1b3822` directly.
- Since the API side is proven current, if Chef can reach financial data, the cause is in the CURRENT repo code's authorization logic (or lack thereof) — not stale infra. Proceeding on that basis.

### Step 2 — Existing auth model (as found, before any changes)

- **`TenantGuard`** (global, runs first): authenticates session cookie, populates `req.ctx = {workspaceId, userId, role}`. Has `@Public()` bypass.
- **`RbacGuard`** (global, runs second): reads `@RequireRole(...)` / `@RequirePermission(...)` metadata off the route; **no-ops (passes through) if the route has neither decorator** — "default-open" by design, per its own code comment, on the assumption every controller route is manually decorated.
- **`@ibirdos/permissions`** package: single source of truth `ROLE_PERMISSIONS` matrix + `can()`/`canAny()`. Has runtime startup assertions that CHEF can never hold `ingredient.update_cost`, `recipe.update_cost`, or billing/`workspace.billing.*` permissions — these currently pass (the matrix itself is correctly locked down for those specific actions).
- **Endpoint audit result (every controller route in invoices/reports/recipes/ingredients/inventory/events IS decorated — no undecorated/default-open financial routes found):**
  - `invoices.controller.ts` — all routes gated by `invoice.*` permissions. CHEF and STAFF hold **none** of `invoice.read/upload/review/confirm/delete`. → Already correctly returns 403 for Chef/Staff on all of `/invoices`.
  - `reports.controller.ts` — all routes gated by `analytics.read` or `analytics.finance.read`. CHEF and STAFF hold **neither**. → Already correctly returns 403 for Chef/Staff on all of `/reports`, including `/reports/vendor-aging`.
  - `recipes.controller.ts` — `GET /recipes`, `GET /recipes/:id` gated by `recipe.read`, which **CHEF and STAFF both legitimately hold** (they need to see recipe names/instructions to cook). `POST :id/recost` also only requires `recipe.read`.
  - `ingredients.controller.ts` — `GET /ingredients`, `GET /ingredients/:id` gated by `ingredient.read`, which **CHEF and STAFF both legitimately hold**. (Write endpoint `POST :id/price` is correctly gated by `ingredient.update_cost`, which they do NOT hold — already blocked.)
  - `events.controller.ts` — `GET /events`, `GET /events/:id` gated by `event.read`, which **CHEF and STAFF both legitimately hold** (they need to see event schedules/menus).
  - `inventory.controller.ts` — `GET /inventory/transactions`, `GET /inventory/alerts/low-stock` gated by `inventory.read`, which **CHEF and STAFF both legitimately hold**. (Write endpoints `adjust`/`import-csv`/`reverse` correctly gated by `inventory.adjust`, which they do NOT hold — already blocked.)

- **Root cause identified:** the permission model is endpoint-level only, not field-level. Recipes/ingredients/events/inventory intentionally share *read* access between financial and non-financial roles for legitimate operational reasons (Chef needs recipe names, ingredient names, event schedules, stock counts). But the response payloads for those same endpoints are NOT stripped of financial fields (cost, price, margin, vendor pricing, revenue/food-cost) before being returned — so any role with the (correct, needed) read permission also receives the (incorrect, unneeded) financial fields in the same JSON body.
- This matches the client's report exactly: "Chef account can access financial data despite permission tests passing" — permission tests likely check endpoint-level 403s on invoices/reports (which correctly pass), not field-level exposure on recipes/ingredients/events/inventory (which currently fail).
- Exact field-level leak inventory pending (background investigation in progress) before implementing the fix.

### Step 3 — Fix: field-level redaction at the service layer

- Added `canViewFinancials(role)` to `@ibirdos/permissions` — reuses `analytics.read` (already OWNER/MANAGER-only, with a startup assertion CHEF can never hold it) as the signal for "may see cost/price/margin/revenue fields."
- Applied at the service layer (not controller) so cost is still computed correctly server-side (live cost math needs real ingredient prices) and only the outbound JSON is stripped for CHEF/STAFF:
  - `recipes.service.ts` — `list()`/`toListDTO()` and `get()` strip `salePriceCents`, all `live*Cost/Margin*` fields, `cachedCost*`, `costHistory`, and per-ingredient `currentCostMicrocents` on nested `ingredients[].ingredient`.
  - `ingredients.service.ts` — `list()`/`toDTO()` and `get()` strip `currentCostMicrocents`/`currentCostCents`, `currentVendorId`, `vendor`, `priceHistory`.
  - `events.service.ts` — `list()`/`get()` strip `quotedPriceCents`, `computedFoodCostCents`, `computedLaborCostCents`, `computedMarginPct`, `markupPct`, labor fields, frozen cost snapshots — including nested `menuItems[].recipe.{cachedCostMicrocents,salePriceCents}` and `kitchenPacket.{totalFoodCostMicrocents, ingredientsJson[].costCents}`.
  - `inventory.service.ts` — transaction list strips `costMicrocents`.
- Verified every stripped field is actually present in the corresponding Prisma `include`/`select` (not a no-op on a field that was never fetched) — checked against `packages/db/prisma/schema.prisma`.

### Step 4 — Fix: page-level route guard (web)

- Found `requireRole()` already existed in `apps/web/src/lib/session.ts` (redirects to `/403`) but was **completely unused** anywhere in the app — this is the exact "hidden sidebar link, no server enforcement" gap the client described. `/invoices` (server component) only called `requireSession()`; `/invoices/new`, `/invoices/[id]`, and every `/reports/*` subpage except the index are `"use client"` components with no server gate at all — a signed-in Chef hitting the URL directly would render the page shell and only fail per-fetch (or not fail at all, if the component doesn't surface API errors).
- Added `apps/web/src/app/[workspace]/invoices/layout.tsx` and `apps/web/src/app/[workspace]/reports/layout.tsx`, each calling `requireRole(["OWNER","MANAGER"])`. Next.js layouts wrap every nested route (including `[id]`, `new`, `vendor-aging`, etc.) and run before any child page — client or server — so this closes the gap for the whole subtree in one place.
- `/403` page already existed and renders correctly (`apps/web/src/app/403/page.tsx`).

**Files changed:**
- `packages/permissions/src/index.ts`
- `apps/api/src/recipes/recipes.service.ts`
- `apps/api/src/ingredients/ingredients.service.ts`
- `apps/api/src/events/events.service.ts`
- `apps/api/src/inventory/inventory.service.ts`
- `apps/web/src/app/[workspace]/invoices/layout.tsx` (new)
- `apps/web/src/app/[workspace]/reports/layout.tsx` (new)

**Commits:**
- `a325efd` — fix(P0-1): strip financial fields from recipe/ingredient/event/inventory API responses for Chef/Staff
- `77612e6` — fix(P0-1): server-side role guard on /invoices and /reports page routes

**Verification:**
- `pnpm typecheck` (turbo, all 9 packages) — clean.
- `packages/permissions/__tests__/rbac.test.ts` (13 tests, existing suite) — pass. Covers CHEF/STAFF lacking `analytics.read`/`ingredient.update_cost`/`recipe.update_cost` at the permission-matrix level, which `canViewFinancials()` is built on.
- No existing integration/e2e test exercises the service methods themselves (recipes/ingredients/events/inventory `.list()`/`.get()`) or the new page layouts against a running server — **needs live verification**: log in as Chef and confirm (a) `/invoices` and every `/reports/*` URL redirect to `/403` even when typed directly, (b) `GET /recipes`, `/recipes/:id`, `/ingredients`, `/ingredients/:id`, `/events`, `/events/:id`, `/inventory/transactions` return 200 with cost/price/margin/vendor/revenue fields absent (not just hidden in the UI — check the raw JSON, e.g. via browser devtools Network tab) while non-financial fields (names, schedules, stock counts) still render normally for Chef.
- Endpoint-level guards on `/invoices/*` and `/reports/*` (Step 2 audit) were already correct pre-fix and unchanged by this commit — confirmed by direct read of both controllers.

---

## P0-2: Duplicate inventory consumption

**Status:** DONE (code fix + investigation). SQL correction for the already-duplicated test data is a template in `NEEDS_ROSHAN.md` — not run.

### Root cause

Two **independent** triggers both auto-consume inventory for the same event, with no coordination between them:

1. `EventsService.updateStatus()` (`apps/api/src/events/events.service.ts`) — when an event's status transitions to `COMPLETED`, `consumeInventoryForCompletedEvent()` walks **every** menu item's recipe and deducts the full ingredient list for the whole event (`sourceKind: "Event"`, `sourceRef: eventId`).
2. `KitchenService.updateTask()` (`apps/api/src/kitchen/kitchen.service.ts`) — when a kitchen task transitions to `DONE`, `consumeIngredients()` deducts that task's single recipe scaled to `targetPortions` (`sourceKind: "KitchenTask"`, `sourceRef: taskId`).

Neither path checked whether the other had already run. Normal workflow is: staff complete kitchen tasks (auto-consume #2 fires per task) → someone later marks the event COMPLETED (auto-consume #1 fires for the entire menu again) → every ingredient is deducted twice. Also, either trigger alone can double-fire on its own (a retried status update, or a task marked DONE → reverted → DONE again), since neither had a self-check either.

### Fix

No schema change needed — used the **existing** `inventory_transactions` table as the idempotency source instead of adding a new column (avoids the additive-migration risk of a Prisma-schema field pointing at a DB column that doesn't exist yet in prod — see safety rules). Added `InventoryService.hasTransactionFor(ctx, sourceKind, sourceRef, kind)` and used it as a guard in both places:

- `EventsService.consumeInventoryForCompletedEvent()` now, before doing anything else:
  1. Skips if an `Event`-sourced CONSUME already exists for this `eventId` (self re-entrancy guard).
  2. Skips the bulk recipe-wide consume if **any** of this event's kitchen tasks already have a `KitchenTask`-sourced CONSUME (per-task consumption already covered it — more accurate since it reflects what was actually prepped). Writes an `event.inventory_consume_skipped` audit entry when this fires. Falls through to the original full consume only for events that never used the kitchen-task board.
- `KitchenService.consumeIngredients()` now skips if a `KitchenTask`-sourced CONSUME already exists for this `taskId` (guards DONE → reverted → DONE re-fires).
- Both paths now write the **event name** into the transaction's `notes` (e.g. `Auto-consume on event COMPLETED — "Smith Wedding"` / `Chicken Piccata × 40 portions — event "Smith Wedding"`). `sourceKind` (`"Event"` vs `"KitchenTask"`) already carries the trigger source — no new column needed for that either.
- `EventsService` now injects `InventoryService` (added `InventoryModule` to `EventsModule` imports — no circular dependency, `InventoryModule` has no imports of its own).

**Explicitly not attempted:** partial-delta reconciliation (e.g., "only consume the ingredients NOT already covered by completed kitchen tasks" for an event that's a mix of some-tasks-done, some-not). That requires a judgment call about intended business semantics I'm not able to verify from the code alone — flagging as out of scope for this pass rather than guessing. Current behavior: if a plurality/any kitchen-task consumption occurred, the bulk consume skips entirely (favors under- over over-consuming).

**Files changed:**
- `apps/api/src/inventory/inventory.service.ts` (`hasTransactionFor` helper)
- `apps/api/src/events/events.service.ts` (guards + inject InventoryService + notes)
- `apps/api/src/events/events.module.ts` (import InventoryModule)
- `apps/api/src/kitchen/kitchen.service.ts` (guard + eventId param + notes)
- `apps/api/src/events/events.service.spec.ts` (updated mock constructor arg count)

**Commit:** (pending — see below)

**Verification:**
- `pnpm typecheck` (all 9 packages) — clean.
- `events.service.spec.ts` (8 tests) + `inventory.service.spec.ts` (5 tests) — pass. No existing test exercises `consumeInventoryForCompletedEvent` or `KitchenService.consumeIngredients` directly (no mocked-Prisma coverage for either) — **needs live verification**: (a) complete all kitchen tasks for a test event, then mark the event COMPLETED, confirm inventory is deducted once per ingredient, not twice — check `/inventory/transactions` for exactly one `CONSUME` row per ingredient per event; (b) mark a kitchen task DONE, revert it, mark DONE again — confirm only one `CONSUME` row for that task; (c) confirm an event with NO kitchen tasks used still gets the full bulk consume on COMPLETED (fallback path unchanged).
- SQL correction for existing duplicate test-data transactions: written to `NEEDS_ROSHAN.md` as a template (Step 1 SELECT to find candidates, Step 2 offsetting `ADJUST` insert to reverse) — **not run**, no live DB access from this session to identify or verify the actual duplicate rows.

---
