# Fix Log — Client Bug-Fix Batch (2026-07-20 →)

Format per issue: Root cause → Fix → Files changed → Commit → Verification status.

---

## DEPLOY-1: Why is production stale? (steps 1–2 of the deploy investigation)

**Status:** Step 1 DONE — root cause found, and it is NOT what was reported to me. Step 2 DONE for the two commit hashes as given (they don't check out) and for today's P0-1..P0-4 work; a full 100-commit line-by-line P0/P1 mapping was not built because the premise (large-scale API staleness) didn't hold — see below for what a corrected, narrower step 2 actually shows.

### The two cited hashes, checked against ground truth

- **`8bf3335`** — does not exist. Checked: every local branch, `origin/master`, `origin/main`, `origin/staging` (after `git fetch origin`), `git log --all`, Railway deployment IDs (project-wide), and GitHub's commit-status API. No match anywhere. Possibly a typo, a hash from a different local clone, or a truncated/mis-copied value from a dashboard. Flagging rather than guessing at what it was meant to be.
- **`09b9bb5c`** — this one **is real**, but it is not stale: `09b9bb5c-1100-41c7-8970-5027dcb6a671` is a **Railway deployment ID** (not a git commit hash) for the `ibirdos_v3_roshan_updated` (API) service. It is the **current, active, successfully-serving** deployment — built from commit `f1b3822` (the tip of `origin/master`), deployed 2026-07-18 22:33 UTC. Confirmed three independent ways: (a) `railway deployment list --service <API service id>` shows it as the latest SUCCESS entry with a timestamp matching `f1b3822`'s commit time to the second; (b) `railway logs 09b9bb5c... --deployment` shows it actively processing real production traffic through today, including `rbac permission denied` log lines for a CHEF-role user hitting `/invoices`, `/reports/vendor-aging`, and `analytics.read` routes — i.e. exactly the endpoint-level guards P0-1 confirmed were already correct; (c) **GitHub's own commit-status API** (`gh api .../commits/f1b3822/status`) shows Railway posted `"Success - api.ibirdos.com"` against deployment `09b9bb5c` directly, and Vercel posted `"Deployment has completed"` for the same commit, both at 2026-07-18 22:33 UTC.

**Conclusion: the API service and the Vercel web app are NOT stale.** Both are current as of `f1b3822`, the exact commit this session's `git rev-parse HEAD` showed at the very start of today's work (before any of my P0-1..P0-4 commits). Auto-deploy is connected and working correctly for both.

### What IS actually stale, and why

The `ibirdos_workers` Railway service (background jobs: invoice-extraction worker, recipe-recost worker, notifications) has not redeployed since **2026-07-08 13:33 IST**, commit `ad07aee4` (`fix(bug-4): wrap xlsx.read in try-catch in recipe importCsv`) — confirmed via `railway deployment list --service <workers-id>` (no successful deploy since) and cross-checked against the same commit's GitHub status.

**Root cause, pinned precisely:** `ad07aee4` itself DID get a `"exquisite-enthusiasm - ibirdos_workers"` GitHub commit-status ("Success"), same as the API service always gets. But checking every commit since — `55cb074`, `abcfcb8`, `82b4e7c`, `97b458f`, and every other commit through `f1b3822` — **none of them carry a workers status at all**, while every single one carries a successful API + Vercel status. The workers-service GitHub integration didn't fail; it stopped being consulted/triggered entirely, starting immediately after `ad07aee4`. There's also a `chore: trigger ibirdos_workers rebuild on 55cb074` commit (`c37a48b`, 2026-07-01) — an empty/marker commit someone made specifically to try to force a workers rebuild — whose status shows only Vercel+API, no workers context either. That confirms this isn't new: **someone already noticed the workers service wasn't auto-deploying, over two weeks ago, and a manual trigger attempt didn't restore it either.**

This means: **any bug fix that lives in `apps/api/src/workers/*` (invoice-extraction, recipe-recost) or in code paths only the workers process, not the API process, executes has not been live since July 8**, regardless of what's in the repo. I can't fix the Railway-side trigger config from the CLI — `railway deployment list`/`logs`/`status --json` are read-only for this. **This needs a manual check in the Railway dashboard**: `ibirdos_workers` service → Settings → Source — confirm it's still linked to `roshankumarvam-create/ibirdos_v3_roshan_updated` on branch `master` with "Deploy on push" (or equivalent auto-deploy toggle) enabled. If it shows disconnected/disabled, re-enabling it there is the actual fix — a manual `railway deployment redeploy` or `up` only re-runs the *old* July 8 build, it wouldn't rebuild from the current commit unless the trigger itself is also fixed.

### Corrected step 2 — what deploying actually resolves

Given the above, "deploy and most bugs disappear" doesn't hold the way it was framed:

- **None of today's P0-1 through P0-4 fixes exist anywhere in already-deployed history.** I investigated and fixed all four fresh against `f1b3822` — the exact commit that's already live. There was nothing to "discover was already fixed." All four are new, currently sitting only in this session's local unpushed commits (`a325efd`..`09c1e9d`, 8 commits, not yet pushed to `origin/master`).
- **The Chef-financial-data issue (P0-1) specifically: NOT already fixed in later history.** Live production logs (captured above) show the endpoint-level guards already worked pre-session (CHEF correctly getting 403 on `/invoices`, `/reports/vendor-aging`, `analytics.read`) — but that's the SAME state I found and documented at session start; the field-level leak (recipes/ingredients/events/inventory payloads carrying cost/price/margin to CHEF/STAFF) was real and unfixed until today's `a325efd`/`77612e6` commits. Nothing in the 100-commit range between `ad07aee4` and `f1b3822` touches this.
- **~100 commits sit undeployed for `ibirdos_workers` specifically**, including several that look P1-relevant and worth checking once workers' auto-deploy is restored: `97b458f` (worker ingredient-matcher fallback), `492ea54` (full-precision unit price on invoice lines — possibly related to the "shortage cost math wrong" P1 item), `55cb074`/`abcfcb8`/`82b4e7c` (Sysco/PDF invoice extraction robustness). I have not individually verified whether any specific P1 item is fully resolved by these — flagging as candidates to re-check after the workers deploy is restored and re-verified live, not asserting they're closed.
- Two commits already live and directly relevant to P0 work I did today: `bb6ba58`/`a7aa04d` (2026-07-08, added the non-blocking client-side invoice reconciliation panel P0-3 built on top of) and `31645aa` (2026-07-19, `markAsPaid` revenue freeze — the pattern P0-4's `rollupCosts()` call follows). Both already deployed; today's fixes extend rather than duplicate them.

**Not yet done:** a full line-by-line audit of all ~100 commits against every remaining P1 item — given the premise (large API-side staleness) didn't hold, that exhaustive pass isn't the highest-value next step. Recommend: fix the workers auto-deploy trigger first, then re-verify each P1 item live (most P1 items — shortage cost math, categories, price history, timezone, recipe quantities/cost drift, labor cost, food-cost%, PO generation, kitchen tasks, waste/yield, reorder thresholds — are API-side, not worker-side, so they're either already live or still genuinely open; only the invoice-extraction-adjacent ones are worker-side and need the redeploy first to test accurately).

**Files changed:** none (investigation only).
**Commit:** none yet — this section is being committed as a docs-only update.

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

**Status: CONFIRMED PARTIALLY INCOMPLETE on the first pass** — re-audited per instruction to check "already fixed?" before assuming so, rather than re-stating the P0-1 status as simply done. The `list()`/`get()` redaction above was real and correct, but it wasn't the *whole* surface. Went through every route CHEF/STAFF can reach (not just the two obvious read endpoints per resource) and found three more leaks:

### Step 5 — Re-audit: three more leaks found and fixed

- **`POST /recipes/:id/recost`** — gated only by `recipe.read` (CHEF holds it), returns `totalCents`/`perPortionCents`/`marginPct`/per-line costs directly in the controller response, completely bypassing the service-layer redaction (which only covered `list()`/`get()`). Fixed in the controller: non-financial roles now get `{staleness, error}` only; the underlying recompute+persist is unchanged (it's cache-freshness bookkeeping, not a cost commit, same as `ingredient_change`-triggered recosts that already happen automatically).
- **`GET /events/:id/ingredient-requirements`** — gated only by `event.read` (CHEF/STAFF hold it), returned `lastUnitPriceCents` and `vendorId` per ingredient sourced from the most recent matching invoice line. Quantities/gaps (legitimate kitchen-prep info) stay visible; price/vendor now stripped for non-financial roles.
- **`PATCH /recipes/:id`** — the biggest one. Returns the full post-update Recipe row from `prisma.recipe.update()` regardless of which fields were actually in the request body. CHEF holds `recipe.update` (intentionally — they edit steps/ingredients) but not `recipe.update_cost`. Before this fix, a CHEF renaming a recipe (or editing any non-financial field) got back the recipe's full pre-existing `cachedCostMicrocents`, `salePriceCents`, `goalFoodCostPct`, `targetMarginPct`, `paperCostCents` in the same response — a bigger leak than the read-only endpoints since it's triggered by an action CHEF performs constantly. Now reuses the same `stripFinancialFields()` helper `get()` already applies.

**Also audited and confirmed already safe (no leak, no change made):** `recipe.create()` and `addIngredient()`/`removeIngredient()` (return only self-submitted input or non-financial fields, never pre-existing others' data); `previewImport()`/`importCsv()` (ingredient matching only selects `id, name`); `ingredients.match()` (name/confidence only, no cost); every `ingredients.controller.ts` and `events.controller.ts` *write* endpoint other than the two above (all gated by permissions CHEF/STAFF don't hold — `ingredient.update`, `event.update`, `event.assign_staff`, `event.delete` — so they 403 before any response body is built, making response-shape irrelevant); all `inventory.controller.ts` write endpoints (`inventory.adjust`, not held by CHEF/STAFF).

**Files changed (this pass):**
- `apps/api/src/recipes/recipes.controller.ts`
- `apps/api/src/recipes/recipes.service.ts`
- `apps/api/src/events/events.service.ts`

**Commit:** `5800f1c` — fix(P0-1): close three more financial-field leaks found on re-audit

**Verification:**
- `pnpm typecheck` (all 9 packages) — clean.
- Full `vitest run` — 285/288 pass, same 3 pre-existing-on-master failures noted throughout this log (unrelated).
- No automated test covers these three response shapes specifically (would need controller-level e2e, not present in this repo for any resource) — **needs live verification**: as CHEF, (a) `POST /recipes/:id/recost` on any recipe → response has no `totalCents`/`marginPct`/line costs; (b) `GET /events/:id/ingredient-requirements` on a paid event with a shortage → response shows quantities/gaps but `lastUnitPriceCents`/`vendorId`/`vendorSku` are `null`; (c) `PATCH /recipes/:id` with just `{name: "..."}` on a recipe that has a real `salePriceCents` set → response's `salePriceCents`/`cachedCostMicrocents`/etc. are all `undefined`, not the real values.
- This re-audit is not a formal guarantee no fourth gap exists elsewhere in the app (e.g. any future new endpoint sharing a financial-role-gated permission needs the same check) — but every current route reachable by CHEF/STAFF across recipes/ingredients/events/inventory has now been read line-by-line, not just the two most obvious per resource.

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

**Commits:**
- `9364698` — fix(P0-2): make event/kitchen-task inventory consumption idempotent
- `d65e945` — docs: log P0-1/P0-2 investigation, fixes, and verification status

**Verification:**
- `pnpm typecheck` (all 9 packages) — clean.
- `events.service.spec.ts` (8 tests) + `inventory.service.spec.ts` (5 tests) — pass. No existing test exercises `consumeInventoryForCompletedEvent` or `KitchenService.consumeIngredients` directly (no mocked-Prisma coverage for either) — **needs live verification**: (a) complete all kitchen tasks for a test event, then mark the event COMPLETED, confirm inventory is deducted once per ingredient, not twice — check `/inventory/transactions` for exactly one `CONSUME` row per ingredient per event; (b) mark a kitchen task DONE, revert it, mark DONE again — confirm only one `CONSUME` row for that task; (c) confirm an event with NO kitchen tasks used still gets the full bulk consume on COMPLETED (fallback path unchanged).
- SQL correction for existing duplicate test-data transactions: written to `NEEDS_ROSHAN.md` as a template (Step 1 SELECT to find candidates, Step 2 offsetting `ADJUST` insert to reverse) — **not run**, no live DB access from this session to identify or verify the actual duplicate rows.

**Re-verified (already fixed, no new work needed):** re-checked per instruction to confirm rather than assume. Searched the whole `apps/api/src` tree for every site that creates a `CONSUME` inventory transaction (`kind: "CONSUME"` literal, plus every `InventoryService.recordTransaction(...)` call) — confirmed exactly two creation sites exist (`EventsService.consumeInventoryForCompletedEvent`, `KitchenService.consumeIngredients`), both still guarded as described above, no third trigger path was missed.

---

## P0-3: Invoice totals / reconciliation

**Status:** DONE (code fix + tests). Live verification of the full confirm() flow still needed.

### Root cause

`InvoicesService.addLine()` / `updateLine()` / `deleteLine()` never touched `invoice.subtotalCents` or `invoice.totalCents` — those fields only ever changed if a reviewer manually typed into the Subtotal/Tax/Total fields on the invoice detail page (`apps/web/.../invoices/[id]/page.tsx`) and blurred out, or clicked the client-side-only "(recalc)" link next to Subtotal. `InvoicesService.confirm()` never checked or recalculated totals either — it validated line count and moved straight to ingredient/inventory processing regardless of what `totalCents` held. So a manually-created invoice, or one where the reviewer added/edited lines without ever touching the totals fields, would confirm successfully with `totalCents` still `null`/stale, and every downstream consumer (Dashboard, Daily Sales, Reports — see P0-4) would show $0 revenue for real money.

Separately, while tracing this I found the existing **client-side-only** reconciliation banner (`apps/web/.../invoices/[id]/page.tsx`) had the same class of bug in miniature: `reconciles = totalCents === 0 || ...` treated a **stored** total of exactly $0 as "nothing to warn about" — but a $0 stored total next to real line items *is* the bug, not a pass condition. The exception should key off the *computed* total from the lines (is there really nothing on this invoice?), not the stored field.

### Fix

- `InvoicesService` now exports two pure functions (`sumInvoiceLineCents`, `reconcileInvoiceTotal`) so the reconciliation math is unit-testable without mocking Prisma/Redis/BullMQ:
  - `sumInvoiceLineCents(lines)` — sum of non-excluded lines' `extendedPriceCents`. Matches the sum already used by the page's (pre-existing) reconciliation banner, not the invoice-header card's separate `computedSubtotal` (which doesn't filter `excluded` — left that one alone; it only feeds its own local recalc button, out of scope here).
  - `reconcileInvoiceTotal(totalCents, subtotalCents, taxCents)` → `"fill"` (total was never set — return subtotal+tax as the value to use), `"block"` (total is set but off by more than 1 cent from subtotal+tax, and the real computed total isn't zero), or `"ok"`. The 1-cent tolerance matches the pre-existing client-side check exactly, so server enforcement never disagrees with what the reviewer already sees.
- `addLine()` / `updateLine()` (when price or excluded flag changes) / `deleteLine()` now call `recalcInvoiceTotals()`, which recomputes and persists `subtotalCents` unconditionally, and fills `totalCents` only if it was never set (so a deliberately-entered/extracted total isn't silently overwritten mid-review — it becomes the reconciliation target instead).
- `confirm()` now recomputes the subtotal fresh from current lines and runs `reconcileInvoiceTotal()` before doing any ingredient/price/inventory work: fills a blank total automatically (no manual click required — this is the direct fix for "$0.00 total despite having lines"), **blocks** with a 400 and a message showing both figures if the stored total doesn't reconcile, and otherwise keeps `subtotalCents` in sync.
- Fixed the same "genuinely zero" inversion in the frontend's dismissible reconciliation banner (`lineSum === 0`, not `totalCents === 0`), and widened its trigger condition from `totalCents > 0` to `lineSum > 0` so it now also surfaces the blank-total case proactively (previously it could never show for a blank total at all, since `totalCents ?? 0` made the gate false). This is the "missing-field/line warning" surfacing called for — the unmatched-ingredient-lines warning and per-line `needsReview` highlighting already existed and needed no change.

**Explicitly not attempted / flagged as a separate question, not guessed:** the task description says "total = lines + tax + fees − credits," implying `DISCOUNT`-category lines should subtract from the total. The `InvoiceLineCategory` enum has `DISCOUNT` and `TAX` values, but nothing in the codebase (confirm(), the pre-existing reconciliation banner UI, or the zod schemas) treats them specially — `extendedPriceCents` is enforced **non-negative** everywhere (`CreateLineSchema`), so a stored "discount" line currently only Increases whatever sum touches it. Deciding whether discount lines should be entered as negative amounts, auto-negated by category, or something else is a real product decision with no existing precedent to follow — implemented `sumInvoiceLineCents` as a flat sum (all non-excluded lines add, matching the one existing convention that existed pre-fix) rather than guess at category-aware signs.

**Files changed:**
- `apps/api/src/invoices/invoices.service.ts` (exported `sumInvoiceLineCents`/`reconcileInvoiceTotal`, `recalcInvoiceTotals` helper, wired into addLine/updateLine/deleteLine/confirm)
- `apps/api/src/invoices/invoices.service.spec.ts` (new — 10 tests on the pure reconciliation functions)
- `apps/web/src/app/[workspace]/invoices/[id]/page.tsx` (fixed the zero-check inversion + widened the reconciliation banner's trigger condition)

**Commit:** `531d75b` — fix(P0-3): auto-recalc invoice subtotal/total, block confirm on mismatch

**Verification:**
- `pnpm typecheck` (all 9 packages) — clean.
- `apps/api/src/invoices/invoices.service.spec.ts` — new, 10/10 pass. Covers: sum with/without excluded lines, blank-total fill, exact match, 1-cent tolerance, block on mismatch (including the literal reported-bug shape: stored total $0, lines sum to real money), and the genuinely-zero-invoice carve-out.
- Full `vitest run` — 279/282 pass; the 3 failures (`recipes.service.spec.ts` × 2, `http-exception.filter.spec.ts` × 1) are **pre-existing on master**, confirmed via `git stash` + rerun before making any P0-3 changes — unrelated to this fix, not touched by it.
- No test exercises the full `confirm()` flow end-to-end (heavy dependency graph: ingredient matching, price updates, inventory receive, recost queue — mocking all of it risked more test-authoring bugs than it caught) — **needs live verification**: (a) create a manual invoice, add lines, confirm WITHOUT touching the Subtotal/Total fields — total should auto-fill and confirm should succeed with the correct total, not $0; (b) create an invoice, manually type a Total that's clearly wrong (e.g. off by $100 from the line sum), attempt to confirm — should be blocked with a clear error, not silently accepted; (c) confirm the reconciliation banner now shows up for a blank-total invoice with real lines on it, before the reviewer even clicks Confirm.

### Step: Re-audit — two more line-creation paths bypassed the recalc entirely

Re-checked (per instruction to verify rather than assume the first pass was complete) every place that creates `InvoiceLine` rows, not just the four `InvoicesService` methods already covered. Found two bulk-insert paths that bypass `addLine()`/`recalcInvoiceTotals()` completely:

- **`InvoicesService.importCsv()`** — uses `tx.invoiceLine.createMany(...)`, never recalculated the invoice's `subtotalCents`/`totalCents` afterward.
- **`apps/api/src/workers/invoice-extraction.worker.ts`** — the AI vision-extraction path, almost certainly the *most common* way invoices actually enter this system (photo/PDF upload → OpenAI Vision → this worker persists the result). It wrote `result.data.subtotalCents`/`totalCents` straight from the AI's own extracted output, with **zero cross-check** against the lines being inserted in the same transaction. If the AI misreads or omits the total — very plausible for real vendor invoices with unusual layouts — the invoice was saved with a stale/blank/wrong total and stayed that way until a human noticed on the review page. This is very likely the literal mechanism behind the reported "$0.00 total despite having lines" bug, more so than the manual/CSV paths.

**Fix:** both now compute the real subtotal from the lines actually being inserted, via the already-exported `sumInvoiceLineCents`. The worker specifically never overwrites an AI-provided `totalCents` (fills it only if the AI returned none) — a genuine AI-vs-lines mismatch is exactly what the reconciliation banner and `confirm()`'s hard block exist to catch; silently overwriting it at extraction time would hide a real extraction error instead of surfacing it. Confirmed via `grep` for every `invoiceLine.create`/`createMany` call site in `apps/api/src` that these were the only two gaps — no third path creates invoice lines.

**Files changed:** `apps/api/src/invoices/invoices.service.ts`, `apps/api/src/workers/invoice-extraction.worker.ts`
**Commit:** `94dec54` — fix(P0-3): recalc subtotal on CSV-imported and AI-extracted invoices too
**Verification:** `pnpm typecheck` clean; `invoices.service.spec.ts` 10/10 pass (unchanged, still covers the pure functions this reuses). **Needs live verification**: upload a real invoice photo/PDF through the extract flow and confirm the resulting invoice's Subtotal on the review page matches the sum of the extracted lines, not whatever raw value the AI happened to output — including the case where the AI extraction is imperfect (mismatched total should now surface via the reconciliation banner, not silently persist).

---

## P0-4: Financial flow wiring (Paid Event → Dashboard/Daily Sales/Reports)

**Status:** PARTIAL — Dashboard-side bug fixed. Daily Sales / most Reports are structurally disconnected from Events entirely (no pipe exists, not a filter bug) — reported to `NEEDS_ROSHAN.md` for a product decision rather than guessed at.

### Investigation — where each surface actually reads revenue from

- **Dashboard** (`/analytics/summary`, `AnalyticsService.summary()` → `eventStats()`) — reads `Event.quotedPriceCents`/`computedFoodCostCents`/`computedLaborCostCents` **directly**. This surface IS wired to events, in principle.
- **Reports: `low-margin-events`, `catering-vs-events`** (`ReportsService.getLowMarginEvents`, `getCateringVsEventProfit`) — also read `Event.quotedPriceCents`/computed fields directly, with **no status filter** at all beyond the date range.
- **Reports: `food-cost-vs-sales`, `labor-cost-vs-sales`, `rent-vs-sales`, `prime-cost`, `sales-by-period`** (5 of 8 report methods) — read **exclusively** from the `daily_sales` table, which is populated **only** by a human manually entering a day's POS numbers on the Daily Sales page (`DailySalesService.create`). No code anywhere creates or updates a `DailySales` row from Event/payment data.
- **Daily Sales page itself** — same table, same story: entirely manual, zero Event awareness.

### Root cause #1 (fixed): Dashboard revenue gated on kitchen-lifecycle status, not payment

`AnalyticsService.eventStats()` filtered events by `status: { in: ["COMPLETED", "IN_SERVICE"] }`. `EventsService.markAsPaid()` sets `paymentStatus: "PAID"` and freezes `quotedPriceCents` but does **not** touch `status` — that's a separate kitchen-lifecycle field (`DRAFT → CONFIRMED → PREP_IN_PROGRESS → IN_SERVICE → COMPLETED`) advanced manually/separately. So a paid event sitting at e.g. `CONFIRMED` (very normal — payment often happens well before the event date) was invisible to the Dashboard's revenue tile even though its revenue was already real and frozen. This inconsistency was visible in-repo: the two Event-reading report methods (`getLowMarginEvents`, `getCateringVsEventProfit`) never filtered by status at all — only `eventStats()` did, and only for revenue. This matches the reported symptom exactly (a paid $312.50 event showing $0 on the Dashboard).

**Fix:** `eventStats()` now filters `paymentStatus: "PAID"` and `status: { not: "CANCELLED" }` (a cancelled event's frozen revenue shouldn't count as delivered regardless of payment) instead of the lifecycle-status list.

### Root cause #2 (fixed): `markAsPaid()` didn't recompute margin after freezing revenue

`EventsService.rollupCosts()` computes `computedLaborCostCents`/`computedFoodCostCents`/`computedMarginPct` from the event's current `quotedPriceCents`. `markAsPaid()` freezes `quotedPriceCents` (fill-only-if-null, first payment only) but never called `rollupCosts()` afterward — so an event with no quote set before payment would get `paymentStatus: PAID` and a real `quotedPriceCents`, but `computedMarginPct` would still reflect the pre-freeze (null) revenue until something else happened to trigger a recompute (e.g. a menu item edit). Dashboard and the two Event-reading reports read `computedMarginPct`/`computedLaborCostCents` directly, not derived-on-the-fly, so this was a real staleness bug.

**Fix:** `markAsPaid()` now calls `this.rollupCosts(ctx, eventId)` immediately after the revenue-freeze update, whenever a freeze happened.

### Root cause #3 (NOT fixed — flagged for a decision): Daily Sales / 5 of 8 Reports have no Event pipe at all

This isn't a filter bug to fix — there is no code path that has ever written event revenue into `DailySales`. `DailySales` is a POS-reconciliation feature (gross/net sales, tax, discounts, voids, refunds, a `tenders` breakdown, and a `variance` check comparing tenders to `netSales`) that's semantically different from "an event got paid." Auto-injecting event revenue into it risks corrupting that variance check for any workspace that also runs a real POS. Three options (auto-inject / explicit event-link column / sum both sources at the report layer instead of the data layer) are written up in `NEEDS_ROSHAN.md` with a recommendation (option 3, lowest risk to the existing feature) — not implemented pending your call.

**Files changed:**
- `apps/api/src/analytics/analytics.service.ts` (`eventStats()` filter)
- `apps/api/src/analytics/analytics.service.spec.ts` (new — 3 tests)
- `apps/api/src/events/events.service.ts` (`markAsPaid()` now calls `rollupCosts()`)

**Commit:** `99ef0b3` — fix(P0-4): count paid-event revenue on Dashboard regardless of kitchen status

**Verification:**
- `pnpm typecheck` (all 9 packages) — clean.
- New `analytics.service.spec.ts` (3 tests) — pass: confirms the query filters on `paymentStatus: "PAID"` / `status: { not: "CANCELLED" }` and explicitly asserts the old `status: { in: [...] }` shape is gone; confirms a PAID-but-early-status event's revenue is counted.
- Full `vitest run` — 285/288 pass; the same 3 pre-existing failures noted in P0-1/P0-2/P0-3 (unrelated to this change).
- **Needs live verification**: mark a test event PAID while it's still at status `CONFIRMED` (not yet `COMPLETED`/`IN_SERVICE`) and confirm its revenue now appears in the Dashboard's Revenue/Margin tiles within the 30-day window; confirm the SAME event's revenue still does **not** appear on the Daily Sales page or the food-cost/labor-cost/prime-cost/sales-by-period reports (expected, per root cause #3 — not yet built).

---
