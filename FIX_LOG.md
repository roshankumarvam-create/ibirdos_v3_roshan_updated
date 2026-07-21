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

**Re-verified (already fixed, no new work needed):** re-checked `eventStats()`'s filter and `markAsPaid()`'s `rollupCosts()` call are both still present and correct. Re-confirmed no other query anywhere filters events by the old `status: {in: [COMPLETED, IN_SERVICE]}` shape (the only other `paymentStatus`/status-filter hits in the codebase are `Invoice.paymentStatus` on the unrelated vendor-aging report, and `markAsPaid()`'s own guard against double-paying). Root cause #3 (Daily Sales / 5 of 8 Reports have no Event pipe at all) remains an open decision in `NEEDS_ROSHAN.md`, unchanged — still correctly not guessed at.

---

## P0-1 AUDIT — endpoint-by-endpoint coverage table (audit only, NO code changes)

**Requested explicitly: audit first, don't build.** This is a fresh line-by-line read of every controller in the current repo (not a re-statement of the earlier P0-1 fix commits above) to answer one question per endpoint: does a guard exist, what does it require, and would CHEF actually be blocked. Read every `.controller.ts` under `apps/api/src` that touches invoices, reports, recipes, ingredients, events, or inventory, plus the permission matrix and both guards (`TenantGuard`, `RbacGuard`) directly — not inferred from prior log entries.

**How the guard mechanism works (for context on the table below):** `TenantGuard` runs first on every non-`@Public()` route and always enforces authentication — that part can't be bypassed. `RbacGuard` runs second and reads `@RequireRole(...)` / `@RequirePermission(...)` off the route; **if neither decorator is present, `RbacGuard` no-ops and the route is reachable by any authenticated role** ("default-open by design" per its own code comment — the guard trusts every controller to self-declare its requirement). So "UNPROTECTED" below means one of: no decorator at all, or a decorator present but using a permission CHEF happens to hold.

CHEF's full permission set, current matrix (`packages/permissions/src/index.ts`): `workspace.read`, `user.read`, `ingredient.read`, `ingredient.match`, `recipe.create`, `recipe.read`, `recipe.update`, `inventory.read`, `event.read`, `kitchen.read`, `kitchen.update_task`, `yield.create`, `yield.read`, `waste.create`, `waste.read`. CHEF holds **no** `*.update_cost`, `invoice.*`, `analytics.*`, `billing.*`, `vendor.*`, `daily_sales.*`, or `inventory.adjust` — those are the permissions this table checks against.

### 1. `/invoices` and invoice API endpoints — `apps/api/src/invoices/invoices.controller.ts`

| Endpoint | Guard | Permission required | CHEF holds it? | Verdict |
|---|---|---|---|---|
| `GET /invoices` | `@RequirePermission` | `invoice.read` | No | **PROTECTED** |
| `POST /invoices` | `@RequirePermission` | `invoice.upload` | No | **PROTECTED** |
| `POST /invoices/extract` | `@RequirePermission` | `invoice.upload` | No | **PROTECTED** |
| `POST /invoices/manual` | `@RequirePermission` | `invoice.upload` | No | **PROTECTED** |
| `GET /invoices/:id` | `@RequirePermission` | `invoice.read` | No | **PROTECTED** |
| `PATCH /invoices/:id` | `@RequirePermission` | `invoice.review` | No | **PROTECTED** |
| `PATCH /invoices/:id/lines/:lineId` | `@RequirePermission` | `invoice.review` | No | **PROTECTED** |
| `POST /invoices/:id/lines` | `@RequirePermission` | `invoice.review` | No | **PROTECTED** |
| `DELETE /invoices/:id/lines/:lineId` | `@RequirePermission` | `invoice.review` | No | **PROTECTED** |
| `POST /invoices/:id/confirm` | `@RequirePermission` | `invoice.confirm` | No | **PROTECTED** |
| `POST /invoices/import-csv` | `@RequirePermission` | `invoice.upload` | No | **PROTECTED** |
| `POST /invoices/:id/retry` | `@RequirePermission` | `invoice.upload` | No | **PROTECTED** |

**Every invoice endpoint is decorated. CHEF holds none of `invoice.*`. All 12 routes return 403 for CHEF.**

### 2. `/reports`, `/reports/vendor-aging` and report API endpoints — `apps/api/src/reports/reports.controller.ts` (+ `apps/api/src/analytics/analytics.controller.ts`, closely related)

| Endpoint | Guard | Permission required | CHEF holds it? | Verdict |
|---|---|---|---|---|
| `GET /reports/food-cost-vs-sales` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /reports/labor-cost-vs-sales` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /reports/rent-vs-sales` | `@RequirePermission` | `analytics.finance.read` | No | **PROTECTED** |
| `GET /reports/prime-cost` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /reports/sales-by-period` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /reports/low-margin-events` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /reports/catering-vs-events` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /reports/vendor-price-changes` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /reports/cost-alerts` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /reports/vendor-aging` | `@RequirePermission` | `analytics.finance.read` | No | **PROTECTED** |
| `GET /analytics/summary` (Dashboard) | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /analytics/recipes/top-margin` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /analytics/recipes/high-cost` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /analytics/recipes/low-margin` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /analytics/ingredients/:id/price-trend` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /analytics/waste/by-reason` | `@RequirePermission` | `analytics.read` | No | **PROTECTED** |
| `GET /analytics/pnl` | `@RequirePermission` | `analytics.finance.read` | No | **PROTECTED** |
| `GET /insights` , `:id`, `:id/acknowledge`, `:id/dismiss`, `:id/actioned`, `_internal/run-now` | `@RequirePermission` (all 6) | `analytics.read` | No | **PROTECTED** |

**Every report/analytics/insight endpoint is decorated with `analytics.read` or `analytics.finance.read`. CHEF holds neither. All 18 routes return 403 for CHEF.**

### 3. Recipe cost/price/margin endpoints — `apps/api/src/recipes/recipes.controller.ts` + `recipes-extract.controller.ts`

| Endpoint | Guard | Permission required | CHEF holds it? | Response financial fields redacted for CHEF? | Verdict |
|---|---|---|---|---|---|
| `GET /recipes` | `@RequirePermission` | `recipe.read` | **Yes** (legitimate — needs recipe names) | Yes — `recipes.service.ts` `toListDTO()` strips `salePriceCents`, `live*Cost/Margin*`, `cachedCost*`, per-ingredient `currentCostMicrocents` via `canViewFinancials()` | **PROTECTED** (field-level) |
| `GET /recipes/:id` | `@RequirePermission` | `recipe.read` | Yes | Yes — same `stripFinancialFields()` helper, verified present at `recipes.service.ts:360` | **PROTECTED** (field-level) |
| `PATCH /recipes/:id` | `@RequirePermission` | `recipe.update` | **Yes** (legitimate — edits steps/ingredients) | Yes — `update()` returns full post-update row but strips financials for `!canViewFinancials(ctx.role)`, verified at `recipes.service.ts:439-441` | **PROTECTED** (field-level) |
| `POST /recipes/:id/recost` | `@RequirePermission` | `recipe.read` | Yes (intentional — recost is cache-freshness bookkeeping) | Yes — controller strips to `{staleness, error}` only when `!canViewFinancials(ctx.role)`, verified at `recipes.controller.ts:158-160` | **PROTECTED** (field-level) |
| `POST /recipes` (create) | `@RequirePermission` | `recipe.create` | Yes (chefs propose recipes) | N/A — only echoes submitted input, no pre-existing financial data to leak | **PROTECTED** (nothing to leak) |
| `POST /recipes/:id/ingredients`, `DELETE .../ingredients/:linkId` | `@RequirePermission` | `recipe.update` | Yes | N/A — line mutation responses don't include cost/price fields | **PROTECTED** |
| `POST /recipes/preview-import`, `POST /recipes/import-csv` | `@RequirePermission` | `recipe.create` | Yes | N/A — ingredient matching in these two only selects `{id, name}`, no cost | **PROTECTED** |
| **`POST /recipes/extract`** (`recipes-extract.controller.ts`) | `@RequirePermission` | `recipe.create` | **Yes** | **NO — no redaction at all.** `canViewFinancials` is not imported or referenced anywhere in this file. | **⚠️ UNPROTECTED — see finding below** |

**Finding — `POST /recipes/extract` leaks ingredient cost to CHEF, not covered by the earlier P0-1 fix pass:** This is a *separate* NestJS controller class (`RecipesExtractController`, registered in `recipes.module.ts` alongside `RecipesController`, both mapped to the `recipes` route prefix) that handles image/Excel/CSV recipe extraction. Its `findIngredient()` helper calls `mapIngredientMatch()`, which always includes `currentCostCents` (from `currentCostMicrocents`) in the matched-ingredient object — this lands in the response as `matchedCostCents` on every enriched ingredient line, for **both** the vision path (`ingredients[]`) and the CSV/Excel path (`ingredientLines[]`). The route is gated only by `recipe.create`, which CHEF legitimately holds (chefs propose recipes). Nothing strips `matchedCostCents` before the response goes out — unlike every other recipe endpoint above, this file never imports `canViewFinancials`. **Concretely: a CHEF uploading a recipe photo, XLSX, or CSV to `POST /recipes/extract` gets back the current cost of every ingredient the extractor auto-matched, in the raw API response — even though `GET /recipes/:id` and `GET /ingredients/:id` both correctly hide that same figure from them.** Not fixed — audit only, per your instruction. Would need the same `canViewFinancials(ctx.role)` guard the other recipe endpoints use, applied to `mapIngredientMatch()`'s two call sites in `recipes-extract.controller.ts`.

### 4. Ingredient cost/vendor/price-history endpoints (GET) — `apps/api/src/ingredients/ingredients.controller.ts`

| Endpoint | Guard | Permission required | CHEF holds it? | Response financial fields redacted for CHEF? | Verdict |
|---|---|---|---|---|---|
| `GET /ingredients` | `@RequirePermission` | `ingredient.read` | Yes (legitimate) | Yes — `list()`/`toDTO()` null out `currentCostMicrocents`, `currentVendorId`, `vendor`, `priceHistory` via `canSeeCost = canViewFinancials(ctx.role)`, verified at `ingredients.service.ts:178-192` | **PROTECTED** (field-level) |
| `GET /ingredients/:id` | `@RequirePermission` | `ingredient.read` | Yes | Yes — same fields redacted at `ingredients.service.ts:580-613` (`get()`) | **PROTECTED** (field-level) |
| `GET /ingredients/missing-threshold-count` | `@RequirePermission` | `ingredient.read` | Yes | N/A — returns only a count, no cost data | **PROTECTED** |

### 5. Ingredient edit/delete endpoints

| Endpoint | Guard | Permission required | CHEF holds it? | Verdict |
|---|---|---|---|---|
| `PATCH /ingredients/:id` (edit name/category/etc.) | `@RequirePermission` | `ingredient.update` | **No** | **PROTECTED** |
| `POST /ingredients/:id/price` (the actual cost-write endpoint) | `@RequirePermission` | `ingredient.update_cost` | **No** — runtime assertion in `packages/permissions/src/index.ts:276-278` throws at startup if this ever changes | **PROTECTED** |
| `DELETE /ingredients/:id` | `@RequirePermission` | `ingredient.delete` | **No** | **PROTECTED** |
| `POST /ingredients/:id/aliases` | `@RequirePermission` | `ingredient.update` | No | **PROTECTED** |
| `POST /ingredients/match` | `@RequirePermission` | `ingredient.match` | Yes (legitimate — invoice-review UI) | N/A — name/confidence only, no cost | **PROTECTED** |
| `POST /ingredients/migrate-display-units` | `@RequirePermission` | `ingredient.update` | No | **PROTECTED** |

### 6. Event revenue/food-cost endpoints — `apps/api/src/events/events.controller.ts`

| Endpoint | Guard | Permission required | CHEF holds it? | Response financial fields redacted for CHEF? | Verdict |
|---|---|---|---|---|---|
| `GET /events` | `@RequirePermission` | `event.read` | Yes (legitimate — schedules) | Yes — `redactEventFinancials()` strips `quotedPriceCents`, `computedFoodCostCents`, `computedLaborCostCents`, `computedMarginPct`, `markupPct`, labor fields, plus nested `menuItems[].recipe.{cachedCostMicrocents,salePriceCents}`; verified at `events.service.ts:340-348` | **PROTECTED** (field-level) |
| `GET /events/:id` | `@RequirePermission` | `event.read` | Yes | Yes — same `redactEventFinancials()`, plus nested `kitchenPacket.{totalFoodCostMicrocents, ingredientsJson[].costCents}` stripped, verified at `events.service.ts:382-424` | **PROTECTED** (field-level) |
| `GET /events/:id/ingredient-requirements` | `@RequirePermission` | `event.read` | Yes | Yes — `lastUnitPriceCents`/`vendorId`/`vendorSku` all gated on `canSeeCost`, verified at `events.service.ts:1098-1122`; quantities/gaps stay visible (legitimate kitchen-prep info) | **PROTECTED** (field-level) |
| `POST /events` (create) | `@RequirePermission` | `event.create` | **No** | — | **PROTECTED** |
| `PATCH /events/:id/menu`, `/menu/:itemId`, `DELETE .../menu/:itemId` | `@RequirePermission` | `event.update` | **No** | — | **PROTECTED** |
| `PATCH /events/:id/quote` | `@RequirePermission` | `event.update` | **No** | — | **PROTECTED** |
| `POST /events/:id/paid` (`markAsPaid`) | `@RequirePermission` | `event.update` | **No** | — | **PROTECTED** |
| `POST /events/:id/staff` | `@RequirePermission` | `event.assign_staff` | **No** | — | **PROTECTED** |
| `POST /events/:id/kitchen-packet/generate` | `@RequirePermission` | `event.update` | **No** — so the packet's unredacted `totalFoodCostMicrocents`/`costCents` (this generation endpoint itself does no stripping) is moot; CHEF can't reach it | **PROTECTED** (blocked before response body is built) |
| `POST /events/:id/send-quote` | `@RequirePermission` | `event.update` | **No** | — | **PROTECTED** |
| `DELETE /events/:id` | `@RequirePermission` | `event.delete` | **No** | — | **PROTECTED** |

### 7. Inventory receive/write-off/recount/adjust endpoints — `apps/api/src/inventory/inventory.controller.ts`

| Endpoint | Guard | Permission required | CHEF holds it? | Verdict |
|---|---|---|---|---|
| `GET /inventory/transactions` | `@RequirePermission` | `inventory.read` | Yes (legitimate — stock counts) | `costMicrocents` redacted per-transaction via `canViewFinancials()`, verified at `inventory.service.ts:161-169` | **PROTECTED** (field-level) |
| `GET /inventory/alerts/low-stock` | `@RequirePermission` | `inventory.read` | Yes | N/A — no cost field in this payload | **PROTECTED** |
| `POST /inventory/ingredients/:id/adjust` (covers write-off/recount — same signed-quantity endpoint, `reason` field distinguishes intent) | `@RequirePermission` | `inventory.adjust` | **No** | **PROTECTED** |
| `POST /inventory/import-csv` | `@RequirePermission` | `inventory.adjust` | **No** | **PROTECTED** |
| `POST /inventory/transactions/:id/reverse` | `@RequirePermission` | `inventory.adjust` | **No** | **PROTECTED** |

**Note on "receive":** there is no standalone receive endpoint — `RECEIVE`-kind transactions are only ever created inside `InvoicesService.confirm()` (gated by `invoice.confirm`, CHEF doesn't hold) and `InventoryService.importCsv()` (gated by `inventory.adjust`, CHEF doesn't hold). Confirmed by grepping every `kind: "RECEIVE"` write site in `apps/api/src` — two sites, both already covered above.

### 8. Other endpoints returning financial fields (cost/price/margin/vendor) found while auditing — outside the client's explicit list but flagging since the ask was "any endpoint returning financial fields"

| Endpoint | Guard | Permission required | CHEF holds it? | Verdict |
|---|---|---|---|---|
| `GET /vendors`, `GET /vendors/:id`, `POST/PATCH /vendors` | `@RequirePermission` | `vendor.read` / `vendor.create` / `vendor.update` | **No** | **PROTECTED** |
| `GET /daily-sales`, `:id`, `POST`, `PATCH`, `DELETE` | `@RequirePermission` (all 5) | `daily_sales.*` | **No** | **PROTECTED** |
| `GET /billing/plans` | `@RequirePermission` | `workspace.read` | **Yes** — but returns only static plan definitions (name/price/features), not workspace-specific financial data | **PROTECTED** (nothing workspace-sensitive to leak) |
| `GET /billing/subscription` | `@RequirePermission` | **`workspace.read`** | **Yes** | **⚠️ UNPROTECTED at the API layer — see finding below** |
| `GET /billing/payments` | `@RequirePermission` | `billing.read` | No | **PROTECTED** |
| `POST /billing/checkout`, `POST /billing/portal` | `@RequirePermission` | `billing.manage` | No | **PROTECTED** |
| `GET /workspaces/:slug` | **None** (no `@RequireRole`/`@RequirePermission` — default-open per `RbacGuard`) | — | N/A, any authenticated role | Returns `{id, slug, name, status, settings, createdAt}` only — no financial fields in the select | **PROTECTED** (nothing to leak, but flagging the missing decorator since it's technically an undecorated route) |

**Finding — `GET /billing/subscription` uses the wrong permission, outside the client's reported list but a real gap the matrix itself anticipates:** The permission catalog has a dedicated `workspace.billing.read` permission — `packages/permissions/src/index.ts` even has a runtime startup assertion (line 262) that CHEF can *never* hold it. But `BillingController.current()` (`GET /billing/subscription`) is decorated with `@RequirePermission("workspace.read")` instead — a permission every role including CHEF and STAFF holds. `BillingService.currentSubscription()` returns the full `Subscription` row: plan, status, `seatQuantity`, and the linked customer's `billingEmail` (not per-seat pricing — `unitAmountCents` lives on the static plan list, not this row — but plan tier + seat count + billing email is still workspace financial/PII data no non-admin role should see). **In practice this is fully mitigated on the web app** — `apps/web/src/app/[workspace]/billing/page.tsx` does its own server-side check (`if (user.role !== "OWNER" && user.role !== "MANAGER") return <...>`) before ever calling this endpoint, and the sidebar link itself is gated on `billing.read` (which CHEF lacks) so it's not even visible. But the **API endpoint is directly callable** by any authenticated CHEF/STAFF session (e.g. via curl with a valid cookie) and would return real subscription data — the UI gate doesn't change what the API allows. Not fixed — audit only. Would need `@RequirePermission("workspace.billing.read")` instead of `"workspace.read"` on that one route.

### Frontend page-route guards — server-side or sidebar-only?

| Route | Guard mechanism | Verdict |
|---|---|---|
| `/invoices` (and every nested route: `/new`, `/[id]`) | `apps/web/src/app/[workspace]/invoices/layout.tsx` — server component, calls `requireRole(["OWNER","MANAGER"])` before rendering any child, redirects to `/403` | **PROTECTED server-side**, not just hidden from sidebar |
| `/reports` (and every nested route: `/vendor-aging`, `/food-cost`, `/labor-cost`, `/prime-cost`, `/vendor-price-changes`) | `apps/web/src/app/[workspace]/reports/layout.tsx` — same `requireRole(["OWNER","MANAGER"])` pattern, wraps the whole subtree | **PROTECTED server-side** |
| `/billing` | Page-level check inside `billing/page.tsx` itself (not a layout, but still a server component running `requireSession()` + a role check before any data fetch) | **PROTECTED server-side** |
| `/daily-sales`, `/vendors` | **No layout.tsx, no page-level role check found** — page would render its shell for CHEF and rely entirely on the API returning 403 on `daily_sales.read`/`vendor.read` (confirmed CHEF lacks both) for the actual data fetch to fail | **Effectively protected (API blocks the data), but not defense-in-depth like invoices/reports/billing** — not explicitly in the client's list, flagging since it's the same "hidden nav only" pattern P0-1 was originally about |
| `/recipes`, `/ingredients`, `/events`, `/inventory`, `/kitchen` | No page-level role gate — **intentional**, CHEF legitimately has read access; API strips financial fields per section 3/4/6/7 above | **Correct as-is** — Chef is meant to see these pages, just without cost/price/margin |

### Summary — what this audit means for next steps

- **Every endpoint explicitly named in the client's report (`/invoices`, `/reports`, `/reports/vendor-aging`, recipe cost, ingredient cost/vendor/price-history, ingredient edit/delete, event revenue/food-cost, inventory adjust) is already PROTECTED** — either by an endpoint-level permission CHEF doesn't hold, or (for the shared-read endpoints recipe/ingredient/event/inventory) by field-level redaction verified present in the actual service code, not just claimed in this log. This matches the code state from the earlier P0-1 commits in this file (`a325efd`, `77612e6`, `5800f1c`) — re-confirmed independently in this pass, not re-derived from trusting those entries.
- **Two real gaps found that were NOT covered by the earlier P0-1 pass:**
  1. `POST /recipes/extract` — CHEF can extract a recipe photo/spreadsheet and get back real ingredient costs (`matchedCostCents`) with zero redaction. This is squarely inside the client's reported category ("recipe cost... endpoints") and should be fixed.
  2. `GET /billing/subscription` — wrong permission (`workspace.read` instead of `workspace.billing.read`), letting CHEF/STAFF read workspace plan/seat/billing-email data at the API layer (mitigated in the UI, not at the API). Outside the client's explicit list but flagged since the ask covered "any endpoint returning financial fields."
- **Conclusion on the framing question:** this is **not** "already protected in code, just not deployed" — it's "protected everywhere the client explicitly listed, with two specific gaps this audit surfaced that need actual code changes." Both are small, isolated fixes (add a `canViewFinancials` check to two call sites in one file; change one decorator's permission string in another) — not a sign of a broader hole in the auth model. Holding both for your go-ahead before touching any code, per instruction.

**Files changed:** none — audit only.
**Commit:** none yet — pending your review of this table.

---

## P0-1 FIX — the two gaps the audit found (guard-only, no business logic changed)

**Confirmed by you as real gaps in current code, not a deployment issue. Both fixed. Everything the audit marked PROTECTED was left untouched — no re-guarding of already-correct endpoints, per your "additive/guard-only" instruction.**

### Roles the permission system grants financial access to (checked before applying either fix, so the guard couldn't lock out a legitimate role)

Read directly from `ROLE_PERMISSIONS` in `packages/permissions/src/index.ts`:
- **`analytics.read`** (the signal `canViewFinancials()` is built on): held by **OWNER** (full permission set) and **MANAGER** (explicit grant, `"// operational analytics; finance still owner-only" — analytics.read` in MANAGER's list). **Not** held by CHEF, STAFF, or CUSTOMER.
- **`billing.read`**: held by **OWNER** (full set) and **MANAGER** (explicit grant, `"// Billing — managers can READ but not change plan" — billing.read`). **Not** held by CHEF, STAFF, or CUSTOMER.
- Both checks are static reads of the matrix, not assumptions — `ROLE_PERMISSIONS.MANAGER` and `ROLE_PERMISSIONS.OWNER` were opened and read line-by-line before writing either fix below, specifically to confirm Manager wasn't about to be locked out.

### Fix 1 — `POST /recipes/extract` (`apps/api/src/recipes/recipes-extract.controller.ts`)

**What was wrong:** this route (a separate `RecipesExtractController`, registered alongside `RecipesController` under the same `recipes` prefix) enriches every extracted ingredient line with `matchedCostCents` via `findIngredient()`/`mapIngredientMatch()`, and never imported or called `canViewFinancials` — the one call site in the whole recipes/ingredients/events/inventory surface that the original P0-1 pass missed.

**Fix:** imported `canViewFinancials` from `@ibirdos/permissions`; added `const canSeeCost = canViewFinancials(ctx.role);` once at the top of `extract()`; changed both enrichment blocks (vision/image path and CSV/Excel path — two separate `.map()` calls, both patched identically) so `matchedCostCents` is `null` when `!canSeeCost`, same pattern already used in `recipes.service.ts`/`ingredients.service.ts`. Every other field on the matched-ingredient object (`matchedName`, `matchedDimension`, `matchedDensityGPerMl`, `matchedCanonicalUnit`) is untouched — those are needed for unit-conversion display while confirming a match and carry no financial information.

**Guard-only, not a permission change:** the route still requires `recipe.create` (unchanged) — CHEF and MANAGER both still hold it and can still upload/extract recipes; only the cost figure embedded in the response is now conditional. OWNER/MANAGER (who hold `analytics.read`) still see `matchedCostCents` exactly as before.

**Files changed:** `apps/api/src/recipes/recipes-extract.controller.ts`
**Commit:** `108df04` — fix(P0-1): strip ingredient cost from POST /recipes/extract for Chef/Staff
**Verification:** `pnpm typecheck` (all 9 packages) — clean. Full `vitest run` on `@ibirdos/api` — 103/106 pass; the 3 failures (`recipes.service.spec.ts` × 2, `http-exception.filter.spec.ts` × 1) are the same pre-existing-on-master failures noted throughout this log, confirmed unrelated (neither failing spec touches `recipes-extract.controller.ts` or `billing.controller.ts`, and both files have no dedicated spec file to begin with). No automated test covers this controller — **needs live verification**, see list in `NEEDS_ROSHAN.md`.

### Fix 2 — `GET /billing/subscription` (`apps/api/src/billing/billing.controller.ts`)

**What was wrong:** decorated with `@RequirePermission("workspace.read")`, a permission every role including CHEF and STAFF holds. Returns the workspace's `Subscription` row (plan, status, `seatQuantity`) plus the linked customer's `billingEmail`.

**Fix:** changed the decorator to `@RequirePermission("billing.read")` — one-line change, matching the sibling `GET /billing/payments` route in the same controller, which already correctly used `billing.read`. Deliberately did **not** use `workspace.billing.read` (the permission this log's audit pass originally floated) — checked the matrix first and found `workspace.billing.read` is OWNER-only (MANAGER is explicitly asserted to never hold it, `packages/permissions/src/index.ts:269-273`), which would have **locked Manager out of a page they currently use**. `billing.read` is the permission this controller's own sibling route already establishes as the "Owner+Manager can view billing, nobody else" line, so using it here is consistent with the rest of the file, not a new precedent.

**Files changed:** `apps/api/src/billing/billing.controller.ts`
**Commit:** `3d0a7b6` — fix(P0-1): gate GET /billing/subscription on billing.read, not workspace.read
**Verification:** `pnpm typecheck` — clean. Full `vitest run` — same 103/106, same 3 pre-existing unrelated failures. No spec file exists for `billing.controller.ts` (checked — none found). Confirmed the only caller in the codebase is `apps/web/src/app/[workspace]/billing/page.tsx`, which already gates itself to `OWNER`/`MANAGER` before making this call — so this fix closes the API-level hole without changing what any real user currently experiences in the UI. **Needs live verification** — see `NEEDS_ROSHAN.md`.

### What was explicitly NOT touched, and why

- `/invoices`, `/reports`, `/reports/vendor-aging` frontend page routes — audit confirmed these already have real server-side `requireRole(["OWNER","MANAGER"])` guards via `layout.tsx` (not sidebar-only). No code change needed; re-verified the two layout files are still in place and unchanged.
- Every endpoint in audit sections 1, 2, 4, 5, 6, 7 (invoices, reports/vendor-aging, ingredient cost/vendor/price-history GET, ingredient edit/delete, event revenue/food-cost, inventory receive/write-off/recount/adjust) — audit found all of these already PROTECTED (either endpoint-gated or field-redacted). Re-guarding them would be adding decorators/checks that already exist, which the "additive/guard-only, don't change business logic" instruction argues against doing without a reason.
- `/daily-sales` and `/vendors` page routes lacking a dedicated `layout.tsx` (noted in the audit as "effectively protected via API 403, not defense-in-depth") — outside both the client's original list and your fix instruction, which named `/invoices`, `/reports`, `/reports/vendor-aging` specifically for frontend guards. Not touched. Flagging again here in case you want it as a follow-up, not doing it unprompted.

**Files changed (both fixes):**
- `apps/api/src/recipes/recipes-extract.controller.ts`
- `apps/api/src/billing/billing.controller.ts`

**Commits:** `108df04`, `3d0a7b6` (kept separate/reviewable per instruction — each is a single-purpose, single-file change).

---

## P0-1 FIX ROUND 2 — Chef/Staff financial-visibility rule applied precisely (kitchen, events, waste)

**Given a precise rule this round** (operational fields stay; cost/price/margin/vendor/price-history/revenue/profit is stripped for endpoints Chef legitimately calls; purely-financial endpoints/pages stay 403'd) rather than a generic re-audit instruction. Re-checked the client's original endpoint list against this rule first — everything there (invoices, reports/vendor-aging, recipe cost, ingredient cost/vendor/price-history, ingredient edit/delete, event revenue/food-cost, inventory adjust) was already correctly handled by the prior two rounds. Ran a fresh sweep specifically for the "endpoint a Chef legitimately calls but the response still carries a $ figure" pattern across every controller CHEF/STAFF can reach, since that's exactly the shape of bug the prior rounds' gaps (recipes/extract, billing/subscription) both were. Found three more, all in files the prior rounds hadn't touched: `kitchen.service.ts`, `events.service.ts` (an incomplete spot in the function that was supposedly already fixed), and `yield-waste.service.ts`.

### Roles confirmed before applying any fix (same check as round 1, redone for this round's specific gate)

Every fix below gates on `canViewFinancials(ctx.role)` — already-established, unchanged function, confirmed again by reading `ROLE_PERMISSIONS` directly: `true` for OWNER (full permission set) and MANAGER (holds `analytics.read`), `false` for CHEF/STAFF/CUSTOMER (none hold `analytics.read`). No new permission was introduced, so there was no new role-lockout risk to check beyond re-confirming this one function's behavior is what every fix assumes.

### Fix 1 — `GET /kitchen/tasks/:id` (`apps/api/src/kitchen/kitchen.service.ts`)

**What was wrong:** `getTask()` calls `prisma.recipe.findFirst()` with no `select` clause when building the response's `recipe` field — meaning every Recipe column, including `salePriceCents`, `cachedCostMicrocents`, `cachedCostPerPortionMicrocents`, `cachedCostUpdatedAt`, `costStaleness`, `costComputeError`, `cachedMarginPct`, `cachedMarginCents`, `targetMarginPct`, and `paperCostCents`, passed straight through. The route requires only `kitchen.read` — held by CHEF and STAFF, correctly, since kitchen/prep is exactly the operational surface they need. The nested `ingredients[].ingredient` select was already scoped to non-financial columns (dimension, canonical unit, density, stock, yield — no cost), so only the top-level recipe row needed the fix.

**Fix:** added the same `canViewFinancials(ctx.role)` check used elsewhere, destructuring out the 11 financial columns listed above when the caller can't see financials. Operational fields (name, category, instructions, prep/cook time, portions, photos, full ingredient list with quantities) are untouched.

**Files changed:** `apps/api/src/kitchen/kitchen.service.ts`
**Commit:** `4006972` — fix(P0-1): strip recipe cost/price/margin from GET /kitchen/tasks/:id

### Fix 2 — `GET /events` and `GET /events/:id` (`apps/api/src/events/events.service.ts`) — three gaps in the existing `redactEventFinancials()`

**What was wrong:** the redaction function from the original P0-1 pass was real but incomplete — it caught the obvious top-level financial fields and one nested recipe object, but missed three more paths through the same response:
1. `menuItems[].unitPriceCentsAtAdd` / `.unitPriceCentsOverride` — sibling fields on the menu-item row itself (not nested in `recipe`), set in `addMenuItem()`/`updateMenuItem()`. The function stripped `mi.recipe.salePriceCents` but never looked at `mi` itself.
2. `kitchenPacket.tasksJson[].totalCostMicrocents` — the function already stripped `costCents` from the sibling `ingredientsJson` array in the same `kitchenPacket`, but never touched `tasksJson`, which carries the same per-recipe-task cost figure (set in `generateKitchenPacket()`).
3. `inventoryShortages[].vendorId` / `.lastUnitPriceCents` / `.estCostCents` — this whole array is written by `markAsPaid()` and persisted directly onto the `Event` row; every later `GET` returned it verbatim, with zero redaction, since the original function never destructured `inventoryShortages` at all.

**Fix:** extended `redactEventFinancials()` to also strip all three, applying your literal rule for the shortage case — `neededCanonical`/`haveCanonical`/`shortCanonical`/`canonicalUnit`/`preferredDisplayUnit` stay (Chef needs to know what's short and by how much to prep around it), `vendorId`/`lastUnitPriceCents`/`estCostCents` are removed. Same for menu items (portions/recipe name stay, price fields go) and kitchen packet tasks (recipe name/portions/prep time stay, cost goes).

**Files changed:** `apps/api/src/events/events.service.ts`
**Commit:** `24d6610` — fix(P0-1): close three more leaks in redactEventFinancials()

### Fix 3 — `stripFinancialFields()` completeness (`apps/api/src/recipes/recipes.service.ts`)

**What was wrong:** cross-checking the full Recipe column list against `packages/db/prisma/schema.prisma` (done while writing Fix 1, to make sure kitchen.service.ts's new strip list was complete) surfaced that `recipes.service.ts`'s own `stripFinancialFields()` — the function `GET /recipes/:id`, `PATCH /recipes/:id`, and `POST /recipes/:id/recost` all already rely on — was itself missing two real columns: `cachedCostPerPortionMicrocents` and `cachedMarginCents`. Grepped for both across `apps/api/src` — neither is written anywhere (dead columns, always `null` today), so this was a latent gap, not an actively-exploited one — but the fix is one line each and the list should be complete regardless of whether something currently populates them.

**Files changed:** `apps/api/src/recipes/recipes.service.ts`
**Commit:** `d126779` — fix(P0-1): strip two Recipe columns stripFinancialFields() had missed

### Fix 4 — Waste endpoints (`apps/api/src/yield-waste/yield-waste.service.ts`)

**What was wrong:** `waste.create`/`waste.read` are held by CHEF — correctly, per your rule ("Waste/yield entry (their own)" is operational). But four methods returned real $ figures with no redaction at all (this module never imported `canViewFinancials` before this fix):
- `recordWaste()` — the created entry's `costMicrocents` (cost basis snapshotted from the ingredient's current price × quantity).
- `listWaste()` — same field, per entry, on the list view.
- `getWasteTargetReport()` — `totalCostCents`, `targetCostCents`, `overTarget`, and a per-reason `costCents` breakdown. This one is essentially a financial report wearing an operational permission — the entire point of the endpoint is "waste cost vs. a dollar target."
- `getEventWasteImpact()` — per-event `costCents`.

**Fix:** applied your rule exactly — kept the operational content (which ingredient, which reason, how much quantity, which event, how many waste events) and nulled only the dollar figures. For the two report methods this meant restructuring the redaction from "field present only when visible" to "field present, value `null` when not" (matching the null-out convention already used in `inventory.service.ts`/`ingredients.service.ts` for the same reason, and because the omit-the-key version produced an unnavigable TS union type against the existing `yield-waste-analytics.service.spec.ts`, whose 8 tests all run as OWNER and expect `costCents` to exist).

**Files changed:** `apps/api/src/yield-waste/yield-waste.service.ts`
**Commit:** `65c867c` — fix(P0-1): strip $ cost from waste endpoints for Chef/Staff

### Verification (all four fixes)

- `pnpm typecheck` (all 9 packages) — clean after every fix, checked incrementally.
- Full `vitest run` on `@ibirdos/api` — 103/106 pass, same 3 pre-existing-on-master failures noted throughout this log (`recipes.service.spec.ts` × 2 unrelated `importCsv`/low-stock-alert mock issue, `http-exception.filter.spec.ts` × 1) — confirmed unrelated, none of the four touched files share a spec file with these failures.
- `events.service.spec.ts` (8 tests) and `yield-waste-analytics.service.spec.ts` (8 tests) — both pass, both exercise the exact functions changed here (all under `role: "OWNER"`, so they also serve as a live check that the Owner-sees-everything path wasn't broken).
- `kitchen.service.ts` has no existing spec file — no automated coverage either before or after this fix.
- No ambiguous fields came up this round — see `NEEDS_ROSHAN.md` for the full endpoint-by-endpoint list this maps to, plus what to test live as Chef vs. Owner/Manager.

**Files changed (this round):**
- `apps/api/src/kitchen/kitchen.service.ts`
- `apps/api/src/events/events.service.ts`
- `apps/api/src/recipes/recipes.service.ts`
- `apps/api/src/yield-waste/yield-waste.service.ts`

**Commits:** `4006972`, `24d6610`, `d126779`, `65c867c`.

---

## P0-1 ROUND 3 — frontend crash fix + remove-columns UX (two client-reported issues)

**Issue 1 (bug): recipe detail page crashed ("Something went wrong", ref 474604855) for Chef/Staff.**

Root cause: `FoodCostBadge` in `recipes/[id]/page.tsx` checked `pct === null` (strict), but the backend redaction (all prior rounds) omits stripped fields from the JSON response entirely rather than sending `null` — so `recipe.liveFoodCostPct` arrives as `undefined` for Chef/Staff, not `null`. `undefined === null` is `false`, so the null-guard never fired and execution fell through to `pct.toFixed(1)` on `undefined`.

Investigated every page rendering financial data for the same bug class and found two more instances: `ingredients/[id]/page.tsx` had a **second real crash** (`ing.priceHistory.length` on an omitted-not-nulled array), and `recipes/page.tsx`'s `MarginBadge` had the identical strict-check bug (non-crashing here, but silently showed a false "HIGH" danger badge on every recipe row). Traced the event detail page's much heavier inline profit/margin arithmetic and confirmed it does NOT crash (already guarded throughout via `??`/ternaries) — it just shows misleading `$0.00`/`—` values, which Issue 2 addresses.

Fixed all three with loose (`== null`) checks, widened every affected TS interface field from `T | null` to optional (`field?: T | null`) to match what the API actually sends, and widened the shared local `fmtCents`/`fmtPct` helpers to accept `undefined`.

**Files changed:** `apps/web/src/app/[workspace]/recipes/[id]/page.tsx`, `apps/web/src/app/[workspace]/ingredients/[id]/page.tsx`, `apps/web/src/app/[workspace]/recipes/page.tsx`
**Commits:** `82bb474`, `a2e7ac8`
**Verification:** `pnpm typecheck` clean after each fix. Grepped the whole `apps/web` tree for the same `=== null` pattern on cost/price/margin-named variables both mid-pass and again at the end — no further instances found anywhere, including kitchen pages (which render no financial fields at all).

**Issue 2 (UX): replace "—" with removing the column/field entirely for roles without financial visibility.**

Applied `canViewFinancials(role)` (same signal every backend redaction this session is built on — OWNER/MANAGER `true`, CHEF/STAFF/CUSTOMER `false`) across every surface the client named plus events (explicitly requested "apply consistently... across recipes, ingredients, inventory, events, reports"):

- **Recipes list** — Live cost/Sale/Margin `<th>`+`<td>` pairs, the inline margin badge, and the LOCKED indicator are omitted entirely, not rendered-then-hidden.
- **Recipe detail** — the whole "Cost summary" sidebar card is omitted; grid layout goes full-width single-column instead of leaving an empty gap. `IngredientsEditor`'s "Line cost" column omitted (added a `canSeeFinancials` prop, same pattern as its existing `canEdit` prop).
- **Ingredients list** — "Cost" column omitted.
- **Ingredient detail** — split the page (was 100% `"use client"` with no server-side role access) into a server wrapper (`page.tsx`, calls `requireSession()`) and the existing interactive component (renamed `IngredientDetailClient.tsx`). "Current cost" key-stat box and the whole "Price history" card omitted. Also hid the Edit form's "Current price" input for the same roles — beyond the literal display-only ask, but Chef doesn't hold `ingredient.update_cost` either, so showing an editable price field that would 403 on save is a failure mode worth closing while already in this file for the same reason. Vendor has no standalone section in this page (only inside price-history rows), so hiding price history covers it.
- **Inventory** — same server-wrapper split (`InventoryClient.tsx`). "Unit cost" column (Current stock tab) and "Cost" column (Transaction history tab) omitted.
- **Events list** — Revenue/Food/Labor/Margin columns omitted.
- **Event detail** — KPI row narrows from 6 cards to just "Guests" (grid adjusts from 6-column to plain 2-up instead of leaving 5 empty slots). `MenuSection`'s "Quote Summary" box and "Unit price"/"Line total" columns omitted. `ShortageBanner`'s "Est. cost to order" column omitted (quantity/gap columns needed for kitchen prep stay). Ingredient-requirements table's "Last price" column omitted. Staff card's hourly-rate and total-labor lines omitted (name/role/hours needed for coordination stay).
- **Reports** — no change needed; Chef/Staff never reach `/reports` at all (existing server-side `requireRole` redirect from earlier this session).

**Additional leak found and fixed while implementing this:** `event.staff[].hourlyRateCents` (employee pay rate) was never touched by `redactEventFinancials()` in any prior round — Chef could see coworkers' hourly wages on the event detail page. Fixed at the source (`events.service.ts`), not just hidden in the UI.

**Also fixed a real correctness bug found along the way:** `MenuSection`'s `hasOverride = mi.unitPriceCentsOverride !== null` evaluated `true` for every menu item once the field started arriving as `undefined` (omitted) instead of `null` for Chef/Staff — every item falsely showed an "overridden" badge. Fixed to `canSeeFinancials && mi.unitPriceCentsOverride != null`.

**Not restricted: Manager.** Your instruction said "Chef, and per client also Manager where applicable" — logged to `NEEDS_ROSHAN.md` rather than guessing which surfaces, since every permission check this session (including runtime assertions) treats Manager identically to Owner for financial visibility, and changing that is a security-relevant decision, not a UI tweak.

**Files changed:**
- `apps/api/src/events/events.service.ts` (hourlyRateCents redaction)
- `apps/web/src/app/[workspace]/recipes/page.tsx`
- `apps/web/src/app/[workspace]/recipes/[id]/page.tsx`, `IngredientsEditor.tsx`
- `apps/web/src/app/[workspace]/ingredients/page.tsx`
- `apps/web/src/app/[workspace]/ingredients/[id]/page.tsx` (rewritten), `IngredientDetailClient.tsx` (new)
- `apps/web/src/app/[workspace]/inventory/page.tsx` (rewritten), `InventoryClient.tsx` (new)
- `apps/web/src/app/[workspace]/events/page.tsx`
- `apps/web/src/app/[workspace]/events/[id]/page.tsx`, `menu-section.tsx`, `shortage-banner.tsx`

**Commits:** `b3e6d7a`, `7d86a26`, `b2d67f2`, `562ad03`, `10f033d`, `19b91fd`, `217b7ec`, `b58abb5`

**Verification:** `pnpm typecheck` (all 9 packages) clean after every commit. No automated frontend test coverage exists for any of these pages (no existing test infra for `apps/web` beyond typecheck) — **needs live verification**: log in as Chef, visit each page above, confirm the listed columns/cards are absent (not present-with-dashes) in both the rendered UI and the raw component tree; log in as Owner or Manager on the same pages, confirm every figure still renders exactly as before.

---

## BUG B — Financial fields leaked on recipe edit/create pages

**Two layers, both fixed.**

**Layer 1 (real security bug, not just UI):** investigating the reported UI leak surfaced that `recipes.service.ts` `create()` and `update()` accepted and wrote `salePriceCents`/`goalFoodCostPct`/`targetMarginPct`/`paperCostCents`/`autoReprice` straight from the request body with **zero permission check**, even though the permission matrix has a dedicated `recipe.update_cost` permission built exactly for this (CHEF is asserted at startup to never hold it, and `POST /:id/recost` already uses it to gate its response). The controller only requires `recipe.update`/`recipe.create` — which CHEF legitimately holds to edit steps/ingredients — so nothing downstream ever checked whether the caller could touch the 5 financial fields specifically. This meant hiding the UI fields alone would have been cosmetic: a Chef could still `PATCH`/`POST` these fields directly (browser devtools, curl) and the values would persist, even though every read path already correctly hid the result.

**Fix:** both methods now check `can(ctx.role, "recipe.update_cost")` and silently drop the 5 fields when the caller doesn't hold it, rather than rejecting the whole request — a Chef's legitimate name/ingredient/procedure edit in the same call still succeeds. Also checked `ingredients.service.ts`'s general `update()` for the same class of bug — it doesn't accept a cost field at all (cost changes only go through the separately-gated `POST /ingredients/:id/price`), so no equivalent gap there.

**Files changed:** `apps/api/src/recipes/recipes.service.ts`
**Commit:** `7d2933c`

**Layer 2 (the reported UI bug):** both pages were 100% `"use client"` with no server-side role access (create page used `useParams()`, edit page used React's `use(params)`) — same pattern as the ingredient-detail/inventory pages fixed earlier this session. Split each into a thin server wrapper (`page.tsx`, calls `requireSession()`) and the existing interactive component (renamed `NewRecipeClient.tsx` / `EditRecipeClient.tsx`), passing `canSeeFinancials` down as a prop.

Omitted entirely for Chef/Staff (not shown as "—"):
- The whole "Cost summary" card: Total ingredient cost, Paper cost input, Total recipe cost, Portion cost, Goal food cost % input, Sell price, Actual food cost %, Margin per portion.
- The whole "Pricing strategy" card: auto-reprice toggle, target margin %.
- "Line cost" column in the ingredients table, and the cost hint in the ingredient search-result dropdown.
- Layout narrows from 3-column (2 + sticky sidebar) to a single full-width column when the sidebar is hidden, with the Save button surfaced standalone.

Also stopped the frontend from even attempting to send the 5 financial fields in the request body for these roles — the API already drops them regardless (Layer 1), so there's no reason to pretend submitting them would do anything.

**Untouched:** name, author, category, description, portions, prep/cook time, ingredients + quantities + % utilized, procedure, photos, video — exactly what Chef/Staff need to actually edit a recipe.

**Files changed:**
- `apps/web/src/app/[workspace]/recipes/new/page.tsx` (rewritten), `NewRecipeClient.tsx` (new)
- `apps/web/src/app/[workspace]/recipes/[id]/edit/page.tsx` (rewritten), `EditRecipeClient.tsx` (new)

**Commit:** `f029e8e`

**Verification:** `pnpm typecheck` (all 9 packages) clean. `pnpm --filter @ibirdos/api test` — 103/106, same 3 pre-existing failures. **Needs live verification**: as Chef, open both pages, confirm Cost summary / Pricing strategy / Line cost are absent; save a recipe with a name change and confirm the response doesn't echo a changed `salePriceCents`/etc.; as Owner or Manager, confirm both pages are unchanged and cost fields still save correctly.

---

## BUG C — Chef/Staff could still see (and were shown UI for) ingredient edit/delete and inventory adjust

**Investigated first, as asked. Answer: server-side was already fully protected. The bug was UI-only — buttons rendered unconditionally, and one page had zero gating of any kind.**

Re-verified current guards directly (not assumed from an earlier pass):
- `PATCH /ingredients/:id` → `ingredient.update` — CHEF/STAFF don't hold it.
- `DELETE /ingredients/:id` → `ingredient.delete` — CHEF/STAFF don't hold it.
- `POST /ingredients/:id/price` → `ingredient.update_cost` — CHEF/STAFF don't hold it.
- `POST /inventory/ingredients/:id/adjust`, `POST /inventory/import-csv`, `POST /inventory/transactions/:id/reverse` → all `inventory.adjust` — CHEF/STAFF don't hold it.

All already correctly 403 for Chef/Staff, unchanged by this fix. What was actually broken:
- Ingredient detail: Edit and Delete buttons rendered unconditionally regardless of role.
- Inventory list: "+ Manual adjustment" and per-transaction "Reverse" rendered unconditionally.
- `/inventory/adjust`: **zero gating of any kind, server or client.** A Chef (or Staff) navigating there directly got the full Receive/Write-off/Recount form and only found out they were blocked after clicking submit.

**Fix:** hid the buttons/pages using the same permission checks the API already enforces (`can(role, "...")`), not new authorization logic. Split `/inventory/adjust` into a server wrapper (redirects to `/403` if the caller holds neither `inventory.adjust` nor `waste.create`) and the existing form (renamed `AdjustClient.tsx`).

**A nuance surfaced during investigation, not guessed at — logged to `NEEDS_ROSHAN.md`:** the adjust page bundles three actions under one "Manual adjustment" umbrella, but they map to two different permissions. Receive and Recount require `inventory.adjust` (Chef/Staff don't hold it — fully blocked, matching the bug report). Write-off routes to `POST /yield-waste/waste`, gated by `waste.create` — which **CHEF does hold**, matching this same session's earlier P1 item "Visible Record Waste/Yield action for Chef." Implemented the permission-accurate version: Chef keeps write-off access, loses receive/recount; Staff (holds neither) is blocked from the page entirely.

**Files changed:**
- `apps/web/src/app/[workspace]/ingredients/[id]/IngredientDetailClient.tsx`, `page.tsx`
- `apps/web/src/app/[workspace]/inventory/InventoryClient.tsx`, `page.tsx`
- `apps/web/src/app/[workspace]/inventory/adjust/page.tsx` (rewritten), `AdjustClient.tsx` (new)

**Commit:** `514a7ce`

**Verification:** `pnpm typecheck` (all 9 packages) clean. **Needs live verification**: as Chef, confirm Edit/Delete are absent on ingredient detail, "Reverse" is absent on inventory transactions, "+ Manual adjustment" leads to a form offering only Write-off; as Staff, confirm navigating directly to `/inventory/adjust` redirects to `/403`; as Owner or Manager, confirm all three surfaces are unchanged.

---

## BUG D — Event date/time shown inconsistently across views

**Investigated first, as asked — see full root-cause writeup in the conversation log. Summary:**

`Event.startsAt` has exactly one write site (`EventsService.create()`, correctly converts local input to UTC via `.toISOString()`) and every frontend view reads it fresh (`cache: "no-store"`, no stale-data risk) through the same shared `formatDate`/`formatDateTime` — those are mutually consistent by construction. The actual inconsistency: `events.service.ts` independently formatted the same `event.startsAt` via raw `new Date(...).toLocaleDateString()` with no timezone specified, in two places (new-event notification text, quote-confirmation email HTML) — running in the **API's** Node process (Railway), a different runtime than the **web app** (Vercel) that renders every other screen. Neither side specified an explicit timezone, so each fell back independently to its own container's ambient default.

Also confirmed: **no per-workspace timezone setting exists anywhere in the codebase** (grepped) — that's the separate, already-logged P1 item ("Event timezone: 5 AM shows as 12 PM"), which explains why the *absolute* time can be wrong. This fix is narrower: making every view agree with every other view, which doesn't require that larger feature.

**Fix:** pinned `timeZone: "UTC"` explicitly on both sides — the two shared frontend formatters and the two backend call sites — so every renderer computes from the same fixed reference regardless of which of the two independent runtimes does the formatting.

**Honesty check, not fully resolved with certainty:** could not reproduce the exact magnitude of the reported example (a different *month*, not just hours) from code alone — every mechanism found explains at most a day-level shift near midnight. Flagged to `NEEDS_ROSHAN.md` — if this doesn't fully resolve what's seen live, it points to a real data issue not yet found, worth a fresh side-by-side comparison with the fix live.

**Files changed:** `apps/web/src/lib/format.ts`, `apps/api/src/events/events.service.ts`
**Commit:** `a119f9d`
**Verification:** `pnpm typecheck` (all 9 packages) clean. `pnpm --filter @ibirdos/api test` — 103/106, same 3 pre-existing failures. **Needs live verification**: open the same event's detail page, kitchen prep list, kitchen service list, and events list side by side, confirm identical date/time; check a "new event" notification and a quote email for the same event, confirm they match too.

---

## ISSUE 1 — Chef could still DELETE recipes (Edit was already correctly blocked)

**Reported from live Chef-role testing on the "smith" event**: Chef could still see and use a working "Delete recipe" button; suspected Edit might also be exposed.

**Root cause, confirmed before fixing:** `recipe.delete` existed in the `PERMISSIONS` catalog (`packages/permissions/src/index.ts`) but was **never granted to any role** in `ROLE_PERMISSIONS` — not even MANAGER. `DELETE /recipes/:id` was gated by `@RequirePermission("recipe.update")` instead — a permission CHEF legitimately holds (to edit recipe steps/ingredients) — so CHEF could delete recipes purely by accident of the wrong check being used, with no dedicated delete permission ever having been wired up for anyone. The delete button's visibility followed the same (wrong) `canEdit` boolean on both the recipe detail page and the recipe edit page, so it was never separately hidden either.

**Edit was investigated and confirmed NOT a bug:** `PATCH /recipes/:id` is correctly gated by `recipe.update`, which CHEF is intentionally meant to hold per the permissions file's own design comment ("Chefs propose recipes and log yield, but not commit cost changes"). The financial fields reachable through that same endpoint (`salePriceCents`, `goalFoodCostPct`, `targetMarginPct`, `paperCostCents`, `autoReprice`) were already blocked by the earlier `recipe.update_cost` check (BUG B, commit `7d2933c`, prior session). No change made to Edit's gating — it was correct already.

**Fix:**
- Added `recipe.delete` to MANAGER's permission set (MANAGER already held explicit delete rights on every other resource — ingredients, vendors, events, daily sales — but was missing it for recipes specifically; granting it here avoids regressing MANAGER's currently-working delete capability, which was not reported as broken).
- Changed `DELETE /recipes/:id` to check `@RequirePermission("recipe.delete")` instead of `recipe.update`.
- Added a startup assertion in `packages/permissions` that throws if CHEF is ever granted `recipe.delete`, matching the existing pattern for `recipe.update_cost`/`ingredient.update_cost`.
- Frontend: recipe detail page — split the single `canEdit`-gated header block so the Edit link stays gated on `canEdit` but `DeleteRecipeButton` is now gated on a new `canDelete = can(role, "recipe.delete")`. Recipe edit page — added a `canDelete` prop (computed server-side, same check) threaded into `EditRecipeClient`, gating its header "Delete" button.

**Files changed:**
- `packages/permissions/src/index.ts`
- `apps/api/src/recipes/recipes.controller.ts`
- `apps/web/src/app/[workspace]/recipes/[id]/page.tsx`
- `apps/web/src/app/[workspace]/recipes/[id]/edit/page.tsx`
- `apps/web/src/app/[workspace]/recipes/[id]/edit/EditRecipeClient.tsx`

**Commits:** `2f15e2b` (backend + permission matrix), `ccf81ab` (frontend button gating)
**Verification:** `pnpm typecheck` (all 9 packages) clean, both commits. `pnpm --filter @ibirdos/api test -- --run` — 103/106, same 3 pre-existing failures (unrelated). **Needs live verification**: as Chef, confirm the Delete button is absent on both the recipe detail page and the recipe edit page, and that `DELETE /recipes/:id` returns 403 if called directly; as Manager/Owner, confirm delete still works.

---

## ISSUE 2 — Event detail page showed "Nov 10" and "7/20/2026" for the same event

**Investigated first, as asked, before any fix — root cause confirmed against `events.service.ts` and `packages/db/prisma/schema.prisma`, not guessed.**

`Event` has exactly one service-date field, `startsAt`, and it was already being read correctly everywhere that matters: the event detail header (`formatDateTime(event.startsAt)`), the Chef prep list page, and the Staff service list page. **This is a display bug, not a data bug** — no event date is stored wrong.

The "7/20/2026" came from two *other* fields on the same event-detail page, both action timestamps that happened to be stamped today, shown without any label distinguishing them from the event date:
- **`event.frozenAt`** — set to `new Date()` (real wall-clock now) when the event transitions to CONFIRMED/PREP/PAID (`events.service.ts` `updateStatus()` and the mark-paid flow). Displayed as "Frozen quote · {date}".
- **`kitchenPacket.generatedAt`** — `@default(now())`, and explicitly reset to `new Date()` on every packet regeneration (`events.service.ts`, kitchen-packet upsert). Displayed as "Packet generated {date}".

Both values were individually correct for what they represent ("when was this action taken"), but sitting next to a header showing the real `startsAt`, with no "locked on" / "generated on" framing, they read as if the same event had three conflicting dates.

**Separately noted, not the cause of this symptom:** `KitchenTask.scheduledStartAt` exists in the schema but is never written by any code path (`events.service.ts` task-generation and `kitchen.service.ts` `explodeFromEvent` both omit it) — dead data, flagged but out of scope here since a null field doesn't render as a specific wrong date.

**Fix (per your direction — relabel + show event date alongside):**
- "Frozen quote" badge now reads "Frozen quote · locked {frozenAt} · event {startsAt}", and its tooltip likewise shows both dates.
- "Packet generated" line now reads "Packet last generated {generatedAt} · for event date {startsAt}".
- Replaced the frozen-quote badge's raw, timezone-unpinned `new Date(...).toLocaleDateString()` with the shared UTC-pinned `formatDate()` helper — the same BUG D fix already applied to every other date on this page, missed on this one call site.
- No schema or write-path change; purely a display fix.

**Files changed:** `apps/web/src/app/[workspace]/events/[id]/page.tsx`
**Commit:** `72eac8d`
**Verification:** `pnpm typecheck` (all 9 packages) clean. **Needs live verification**: open the "smith" event detail page, confirm the Frozen-quote badge and Packet-generated line now both show the event's real date (Nov 10) alongside their respective action date, and that the header, prep list, and service list all still agree with each other.

---

## P0-2 — duplicate inventory consumption: backtested with real production data, real root cause was NOT the hypothesized one

**You asked me to prove this with actual data before and after fixing it, not just reason about the code. Here's the evidence.**

### Part 1 — proving the bug with real data

Queried production `inventory_transactions` directly (via `railway run` against the public Postgres proxy) for the client-reported ingredients. Found the duplicate live, in `cafe-71`, against an event called "Test Event" (`cmrs4hn1500jf9uv8ywaqe6wn`, status DRAFT):

| Ingredient | Txn 1 | Txn 2 (duplicate) |
|---|---|---|
| Tofu, Extra Firm Org/C | `−11339.8 g`, `sourceKind=KitchenTask`, `sourceRef=cmrs4niyy00jo9uv8nwukmduu`, 18:30:09 | `−11339.8 g`, `sourceKind=KitchenTask`, `sourceRef=cmrs4niyy00jp9uv8twulytqm`, 18:30:48 |
| Asparagus, Large (Contract) | `−2267.96 g`, same `sourceRef` as above | `−2267.96 g`, same `sourceRef` as above |

**This disproves the hypothesis I reported after the code-only investigation.** Both rows have `sourceKind: "KitchenTask"` — neither is `sourceKind: "Event"`. This was never an event-confirm-vs-kitchen-task-completion race. Pulling the two `KitchenTask` rows behind those `sourceRef`s showed the real mechanism: `cmrs4niyy00jo...` is `"PREP: Grilled Tofu & Asparagus Bowl"` (`taskType: "PREP"`) and `cmrs4niyy00jp...` is `"SERVICE: Grilled Tofu & Asparagus Bowl"` (`taskType: "SERVICE"`) — same `recipeId`, same `targetPortions: 50`, both marked `DONE` 39 seconds apart. `EventsService`'s kitchen-task generation (inside `markAsPaid()`) creates **both** a PREP and a SERVICE task per menu item, always. `KitchenService.updateTask()`'s auto-consume fired on **any** task reaching `DONE` with a `recipeId` + `targetPortions`, with no `taskType` check — so completing the normal, expected PREP → SERVICE workflow deducted the same ingredients twice, every time, for every event. This is a much more consistently-reproducible bug than the theorized race condition — it doesn't need unusual ordering, it happens on the default happy path.

The asymmetric event-vs-kitchen-task guard gap identified in the earlier code-only investigation (Issue 2 session) is real too, just not what produced this specific incident — see Part 3 below, it's separately confirmed fixed.

### Part 2 — the fix (adjusted to match the confirmed cause)

`apps/api/src/kitchen/kitchen.service.ts`, `updateTask()`: added `&& task.taskType !== "SERVICE"` to the auto-consume trigger condition. SERVICE tasks represent plating/serving already-prepped food, not raw-ingredient consumption; only PREP (or any non-SERVICE task type) should trigger `consumeIngredients()`.

Also kept the guard already added earlier this turn (before the backtest): `consumeIngredients()` now also checks `hasTransactionFor(ctx, "Event", eventId, "CONSUME")` before deducting, so if the event-level bulk consume already ran (e.g. event marked COMPLETED before any kitchen task), a kitchen task completed afterward correctly skips instead of re-deducting. This addresses the separate, rarer asymmetric-ordering gap found during the Issue 2 code investigation — real, but not the cause of the Tofu/Asparagus incident.

### Part 3 — backtesting the fix with real data

Could not use a staging environment (none exists). Instead: imported the actual `EventsService`/`KitchenService`/`InventoryService` classes via `tsx`, connected them to the real production Postgres/Redis (public proxy URLs), and ran them against an isolated test workspace (`roshantest`) so no client data was touched. Created a throwaway ingredient/recipe/event per test, called the real `markAsPaid()`/`updateStatus()`/`updateTask()` methods exactly as the API would, and deleted everything afterward (confirmed via a final query — no residue left).

**Test A — PREP done, then SERVICE done (the actual production scenario):**
- After PREP marked DONE: 1 CONSUME row, stock 1000g → 890g (110g = 100g recipe requirement × 1.10 default portion multiplier).
- After SERVICE marked DONE: still 1 CONSUME row, stock still 890g. **PASS — no second deduction.**

**Test B — event marked COMPLETED first (bulk consume), then a kitchen task marked DONE:**
- After event COMPLETED: 1 CONSUME row (`sourceKind: "Event"`), stock 1000g → 890g.
- After kitchen task marked DONE afterward: still 1 CONSUME row, stock still 890g. **PASS — the `hasTransactionFor(ctx, "Event", ...)` guard added this turn stops the reverse-order gap.**

**Test C — kitchen task done first, then event marked COMPLETED (reverse of B, exercises the pre-existing guard):**
- After PREP marked DONE: 1 CONSUME row, stock 1000g → 890g.
- After event marked COMPLETED: still 1 CONSUME row, stock still 890g. **PASS — confirms the guard that already existed in production before this session still works.**

All three PASS. Full transaction-by-transaction output captured during the session; not reproduced in full here for length, available on request.

### Part 4 — reversing the existing duplicated data

Wrote (not run) the exact SQL to reverse the Tofu/Asparagus duplicate found in Part 1, as a compensating `ADJUST` transaction (not a delete — keeps the audit trail intact) plus the matching `ingredients.current_stock_canonical` update, with a `WHERE current_stock_canonical = <expected>` safety guard on each `UPDATE`. See `NEEDS_ROSHAN.md`, "P0-2 — safe SQL to reverse the existing duplicated Tofu/Asparagus consumption."

**Files changed:** `apps/api/src/kitchen/kitchen.service.ts`
**Commit:** `96431b7`
**Verification:** `pnpm typecheck` (all 9 packages) clean. `pnpm --filter @ibirdos/api test -- --run` — 103/106, same 3 pre-existing failures (unrelated). Live-backtested against real production data in an isolated test workspace (`roshantest`) as described above — all 3 scenarios PASS. **Live test steps for you to re-confirm on a real event once deployed:** create an event with a menu item, mark it paid (generates PREP + SERVICE kitchen tasks), mark the PREP task DONE, check `/inventory/transactions` for that ingredient (expect exactly one new CONSUME row), then mark the SERVICE task DONE and check again (expect the same count, no new row, stock unchanged).

---

## Timezone display bug — root cause investigated, per-workspace timezone shipped

**Investigated first, as asked, before any fix.** Report given in full in conversation; summary: pulled the real "smith 2" event (workspace `roshancafe99999`) from production. `event.startsAt` (`2026-07-22T05:41:00.000Z`) was stored correctly — the write path already converts the browser's local `datetime-local` input to the right UTC instant on submit (`new Date(startsAt).toISOString()`, run client-side, so it uses the user's real browser timezone). `event.inventoryCheckedAt` (`2026-07-21T10:41:21.824Z`) is a separate action-timestamp field (stamped whenever the system auto-checks ingredient availability, same pattern as `frozenAt`/`generatedAt` from the earlier "event date" bug) — not the same instant as `startsAt` at all. Both displays were individually correct UTC readouts of their respective fields. **The actual bug:** nothing in the app ever converted stored UTC back to the viewer's real local time — the earlier "BUG D" fix deliberately UTC-pinned every formatter for cross-view consistency and explicitly flagged (in its own code comment and in `NEEDS_ROSHAN.md`) that it did not solve "match the venue's actual local time." A user in IST entering 11:11 AM correctly got 05:41 UTC stored, then saw the raw UTC reading "5:41 AM" on every screen instead of "11:11 AM."

**Fix, approved plan: per-workspace timezone, one shared formatter, no exceptions.**

- `packages/types/src/datetime.ts` (new) — the ONE formatter both `apps/web` and `apps/api` use: `formatInWorkspaceTz` (core) plus `formatWorkspaceDate`/`DateTime`/`Time` wrappers, and `getWorkspaceTimeZone(settings)` reading `Workspace.settings.timezone` (existing JSON blob, no migration) with `DEFAULT_WORKSPACE_TIME_ZONE = "America/Los_Angeles"` as the fallback for workspaces created before this shipped.
- `WorkspacesService.signup()` sets the default timezone at creation. New `PATCH /workspaces/:slug` (`workspace.update` permission) merge-updates it, validated against `Intl.supportedValuesOf("timeZone")` — always-current IANA list, nothing hand-maintained.
- `SessionUser` (frontend) and `TenantContext` (backend) each gained a `workspaceTimeZone` field, resolved once per request by extending a query each already runs (`AuthService.login()`/`me()`, `TenantGuard`) to also select `settings`. Every existing `requireSession()`/`ctx` call site gets it for free — zero new fetches.
- `apps/web/src/lib/format.ts`'s `formatDate`/`formatDateTime` now require a `timeZone` argument (no more implicit `"UTC"`); added `formatTime`; `relativeTime` also takes `timeZone` for its 30-day-plus absolute-date fallback.
- Converted every date/time display in the app: event header, frozen-quote badge, "check inventory checked", packet-generated line, events list, kitchen prep/service lists, kitchen task detail (prep-by / completed-at), ingredient price history, invoice list/detail, recipe cost-cache timestamp, billing period dates, settings users list/detail, daily-sales date grouping labels, inventory alerts/transactions relative time, waste/yield relative time. Two fully-client pages with no server wrapper (invoice detail, edit-user) were split into a thin server `page.tsx` + renamed `*Client.tsx` (matching the pattern used elsewhere this session) so they can reach `requireSession()`. Two backend-rendered strings (chef notification body, quote email) switched from a raw UTC-pinned `toLocaleDateString()` to the same shared formatter with `ctx.workspaceTimeZone`.
- New Settings → Workspace page (`workspace.update` permission) with the timezone picker.
- **Explicitly out of scope:** `apps/web/src/app/platform/PlatformAnalyticsCards.tsx` — the cross-tenant admin view spans many workspaces at once, so "one workspace's timezone" doesn't apply; flagged, not touched.
- Confirmed via grep: zero remaining raw `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString` calls in either app, and zero `formatDate`/`formatDateTime`/`relativeTime` call sites missing the new required timezone argument.

Storage and DB sorting/filtering (`upcoming events`, etc.) unchanged — display-only change built on already-correct UTC storage.

**Files changed:** `packages/types/src/{datetime.ts (new),index.ts}`, `packages/db/src/index.ts`, `apps/api/src/{auth/auth.service.ts, common/guards/tenant.guard.ts, events/events.service.ts, workspaces/{workspaces.controller.ts,workspaces.service.ts}}`, 24 files under `apps/web/src` (2 new client components, 1 new settings route, rest edited).
**Commit:** `f117d39`
**Verification:** `pnpm typecheck` (all 9 packages) clean. `pnpm --filter @ibirdos/api test -- --run` — 103/106, same 3 pre-existing failures (unrelated). **Needs live verification** (not yet pushed/deployed): create an event at a specific time, confirm it shows that same time on event detail, event list, and kitchen prep/service views; then change the workspace's timezone in Settings → Workspace and reload — every view should update together.

---

## P0-3 re-verification — ALREADY FIXED in deployed code; real root cause of remaining bad data was a ~2.4-day deploy gap, not a code bug

**Asked to investigate P0-3 fresh with real data before touching anything. Did that first — no code change was needed.**

### Is the fix from `531d75b`/`94dec54` still in the code? Yes, confirmed by reading the current file.

`sumInvoiceLineCents`, `reconcileInvoiceTotal`, and `recalcInvoiceTotals` are all present and wired into `addLine`/`updateLine`/`deleteLine`/`confirm`/`importCsv`/the AI-extraction worker exactly as the prior FIX_LOG P0-3 entry describes. No regression, nothing missing.

### Real-data check #1 — are there invoices in prod with lines but $0.00/blank total?

Yes: **39** across all workspaces, including the exact client-reported invoices — Charlie's Produce `TEST-TOFU-002` (1 line, "Tofu, Extra Firm Org/C", $150.00, `totalCents: null`) and several `Sysco`/`SYSCO` invoices with `totalCents: 0` despite real line sums ($1,588.16, $1,047.71, etc.).

### Real-data check #2 — is this the fix failing, or stale data from before the fix went live?

Cross-referenced every one of the 39 invoices' `confirmedAt`/`updatedAt` against the actual Railway deployment history (`railway deployment list`). Found a critical gap: the deployment immediately before the fix commits (`09b9bb5c`, 2026-07-18T22:31:51Z) predates them; the *next* deployment after that (`f671ccd1`, 2026-07-21T05:57:02Z) is the earliest point the fix could possibly have been live — **a ~2.4-day gap with zero deploys**, consistent with this session's own earlier `DEPLOY-1` finding that Railway's GitHub webhook has been dead this whole time and deploys only happen via manual `railway up`.

**Result: all 39 broken invoices were last touched BEFORE 2026-07-21T05:57:02Z. Zero invoices of any kind — broken or not — have been created/confirmed/updated since.** The fix was committed to git on 2026-07-19 (~20:15–22:23 UTC) but the production API kept running the old, pre-fix code for almost two more days because nothing redeployed it. Every one of the 39 bad invoices, including the client's literal reported examples, was processed by that stale code. This is a deploy-lag artifact, not a defect in the fix itself.

### Real-data check #3 — since no real invoice has been confirmed against the live fix yet, proved it works via a live backtest (same method as P0-2)

No staging environment exists, so imported the actual `InvoicesService` class via `tsx` and ran its real `createManual`/`addLine`/`confirm` methods against production Postgres/Redis, scoped to the isolated `roshantest` workspace (client data untouched; all created rows deleted afterward, confirmed clean). The service's constructor eagerly creates two BullMQ queues that hang when constructed outside a real worker process against the public Redis proxy — worked around by building the instance via `Object.create(InvoicesService.prototype)` with stub queues instead of calling the real constructor, since neither queue is touched by the code paths under test.

Three scenarios, all **PASS**:
- **The literal reported bug** — manual invoice, one $150.00 line, total never touched by hand: subtotal auto-recalculated to $150.00 the moment the line was added; `confirm()` auto-filled the total to $150.00 and succeeded — no manual Recalc click, exactly the required behavior.
- **Total entered but wrong** — total manually set to $999.99 against $150.00 of lines: `confirm()` threw and blocked with `"Invoice total ($999.99) doesn't match the sum of lines + tax ($150.00). Fix the line items or update the total before confirming."` Invoice correctly stayed `PENDING_REVIEW`, not confirmed.
- **Incremental multi-line recalculation** — subtotal correctly updated after each of two sequential `addLine()` calls ($10.00 → $35.00), not just once at confirm time.

**One behavior worth noting, not a bug:** once a total is auto-filled after an early line (e.g. after just 1 of 2 lines), it becomes the reconciliation anchor — adding a further line does NOT silently re-fill it again; if the total no longer matches, `confirm()` blocks until a human looks at it. This is the correct, intended trade-off already described in the original P0-3 entry ("a deliberately-entered/extracted total isn't silently overwritten mid-review") and it's exactly the "block on non-reconciling total" behavior the client asked for — flagging only so it doesn't read as a gap.

### Status of the two things the original fix explicitly left open — still open, unchanged

- **Should `DISCOUNT`-category lines subtract from the total?** Still an open product decision in `NEEDS_ROSHAN.md` ("P0-3 — Should DISCOUNT-category invoice lines subtract from the total?"). Nothing since has resolved it; not guessed at here either.
- **The 39 stale bad invoices already in the database** — 22 are still `PENDING_REVIEW`/unconfirmed and will self-correct (or correctly block with a clear message) the next time someone opens and confirms them, no backfill needed. The other **17 are already `CONFIRMED`** — locked financial records the fixed code will never touch again on its own. Backfilling these means rewriting historical financial data, which I'm not doing unattended. Exact backfill SQL (one `UPDATE` per invoice, guarded by the row's current stored total so it's a no-op if anything's changed since I checked) is in `NEEDS_ROSHAN.md`, not run.

**Files changed:** none — investigation and live backtest only, no code change needed.
**Commit:** none (docs-only; see next commit).
**Verification:** Live-backtested against real production data in an isolated test workspace (`roshantest`) as described above — all 3 scenarios PASS, matching every required behavior in the bug report. **Live test for you to do once you're back**: open one of the 22 still-`PENDING_REVIEW` stale invoices (e.g. `cmrq7e9ze00ft104ywzy6xz4z`) and confirm it — should now either succeed with a corrected total or block with a clear reconciliation message, never silently save at $0 again.

---

## P0-4 re-verification — Dashboard fix confirmed working with real data; found and explained the two NEW report complaints; Daily Sales gap unchanged, still a decision

**Asked to investigate fresh with real data, check what's already fixed vs still broken, and flag scope rather than rebuild reporting unattended. No code change was needed — this is a verification + root-cause report.**

### Is the P0-4 Dashboard fix (`99ef0b3`) still in the code? Yes.

`AnalyticsService.eventStats()` still filters `paymentStatus: "PAID"` / `status: { not: "CANCELLED" }`, and `EventsService.markAsPaid()` still calls `rollupCosts()` after freezing revenue. Both confirmed present and correct by reading the current files.

### Real-data check — found the client's literal $312.50 event and ran the actual Dashboard query against it

Event `cmrs4hn1500jf9uv8ywaqe6wn` ("Test Event", `cafe-71`) — `quotedPriceCents: 31250`, `computedFoodCostCents: 20307` — exactly $312.50 / $203.07, the client's reported numbers. Called `AnalyticsService.summary(ctx, 30)` for real (no mocks) against `cafe-71`:

```json
{ "eventCount": 1, "eventRevenueCents": 31250, "eventFoodCostCents": 20307, "eventLaborCostCents": 0, "eventMarginPct": 35.0176 }
```

**The Dashboard shows this event correctly right now** — $312.50 revenue, $203.07 food cost, 35.02% margin, matching the client's reported numbers almost exactly (their "35%" vs the precise 35.0176%). The fix works. Also noticed `AnalyticsService.summary()` computes `eventMarginPct` **live** from revenue/food-cost/labor-cost, not by reading the stored `Event.computedMarginPct` field — more robust than the original P0-4 writeup assumed, and it's why the Dashboard is correct here even though this specific event's stored `computedMarginPct` is still `null` (see below).

### New finding — 2 PAID events (including this exact one) have a stale null `computedMarginPct`, same deploy-lag cause as P0-3

This event's `frozenAt`/`createdAt` is 2026-07-19 — before the same ~2.4-day Railway deploy gap identified in the P0-3 re-verification (fix committed 2026-07-19, first live deploy 2026-07-21T05:57:02Z). `markAsPaid()`'s `rollupCosts()` call didn't exist in the *running* code yet when this event was paid, so `computedMarginPct` was never backfilled onto the row. Queried all PAID events: only **2** total have this staleness (`cmrs4hn1500jf9uv8ywaqe6wn` above, and `cmrrvqmj3004c9uv8t1cnjdj8` / "ans event" in another test workspace). Consequence: `ReportsService.getLowMarginEvents()` filters `computedMarginPct: { not: null }`, so these 2 events are **silently missing** from that one report specifically (Dashboard and `getCateringVsEventProfit` both compute margin live and are unaffected — verified both directly). Self-heals the moment either event's menu is edited again (two other call sites already trigger `rollupCosts()` on menu changes) — not filing this as a bug to fix, just flagging exactly what's affected: open + re-save either event's menu once to force the recompute, or wait for the next natural edit.

### The two NEW client complaints not covered by the original P0-4 investigation — both traced to real root causes

**"Vendor Price Changes showed no results"** — `ReportsService.getVendorPriceChangeReport()` requires **2+ price points** for the same (ingredient, vendor) pair to compute a % change (a single price is not a "change"). Called it for real against `cafe-71`: it returns a real result right now — Tofu, Charlie's Produce, $0.00964/g → $0.01102/g, **+14.32%**, 2 data points. **The report itself has no bug.** The client's "no results" almost certainly happened before this workspace had two confirmed invoices for the same ingredient/vendor yet — very plausibly *because of* P0-3 (an invoice stuck unconfirmed at $0 total never reaches `updatePrice()`, so it never creates a price-history point at all). This should already be resolved for the client now that P0-3's fix is live and more invoices are confirming successfully.

**"Vendor Aging only showed the invoice whose total saved correctly"** — `ReportsService.getVendorAging()` requires `totalCents: { not: null }` but does *not* exclude `totalCents: 0`. Called it for real against `cafe-71`: **Alki Bakery** (a correctly-totaled invoice) shows a real $128.29 balance; **Charlie's Produce** and **Sysco** both appear in the list but show **$0** across every aging bucket — because their real confirmed invoices are exactly the P0-3 stale-total rows (`totalCents: 0`). **This is the same P0-3 root cause, not a separate bug in the aging report.** The 17-invoice backfill proposed in `NEEDS_ROSHAN.md` (P0-3 section) is what fixes this too — once those totals are corrected, their real balances will appear here automatically, no change needed to `getVendorAging()` itself.

### Daily Sales / 5-of-8 reports — unchanged, still correctly flagged as a decision, not rebuilt

Re-confirmed: `DailySales` has no `eventId`/link column in the schema, and grepped every `dailySales.create`/`update`/`upsert` call site in `apps/api/src` — all live inside `daily-sales.service.ts`'s manual-entry flow only, nothing in `events.service.ts` writes to it. Structurally identical to what the prior P0-4 entry found; nothing has changed. Per your explicit instruction not to build large reporting rework unattended, this stays exactly as already documented in `NEEDS_ROSHAN.md` ("P0-4 — Daily Sales and most Reports are structurally disconnected from Events") — not touched, not guessed at.

**Files changed:** none — investigation and direct real-data verification only (called the actual `AnalyticsService`/`ReportsService` methods via `tsx` against production, no mocks, read-only, no side effects to clean up).
**Commit:** none (docs-only; see next commit).
**Verification:** Every claim above is backed by literally running the real service method against real production data for `cafe-71`, not inference. **Live test for you to do once you're back**: open the Dashboard for `cafe-71` and confirm the $312.50 event now shows; check `/reports/vendor-price-changes` and confirm the Tofu/Charlie's-Produce entry appears; check `/reports/vendor-aging` and confirm Alki Bakery shows $128.29 while Charlie's Produce/Sysco still show $0 (expected, until the P0-3 backfill runs); confirm Daily Sales and the 5 daily-sales-fed reports still show nothing for this event (expected, pending your call on the 3 options already in `NEEDS_ROSHAN.md`).

---

## P0-3 — backfill executed: 16/16 stuck CONFIRMED invoices corrected, fully re-verified

The backfill SQL proposed in `NEEDS_ROSHAN.md` (P0-3 section) was executed against production, with Roshan's explicit go-ahead, in two passes:

**Pass 1 (via Roshan running the SQL in Railway's dashboard query box, one statement at a time as instructed):** only 1 of 16 statements actually applied (`cmrt5lxw200lm9uv8ov74hbvs`) — confirmed the other 15 were untouched (`updatedAt` unchanged) via a full re-verification pass. Root cause: Railway's web query box does not reliably execute a full pasted multi-statement batch; it appears to have run only one of the 16 lines submitted.

**Pass 2 (Roshan asked me to execute the remaining 15 directly against prod):** re-recomputed all 15 invoices' correct `subtotal_cents`/`total_cents` fresh from their *current* line items (not the earlier snapshot — the two had not drifted, but recomputed live to be certain), then ran all 15 as a single Prisma `$transaction` (one real connection/session, atomic) with the same per-row `WHERE id = ... AND workspace_id = ... AND total_cents = <expected>` guards as the original proposal. All 15 reported exactly 1 row affected, no unexpected 0s or multi-row matches.

**Final verification, all 16 invoices (15 just backfilled + the 1 from the partial Railway run):** every one now has `subtotalCents === totalCents === (fresh sum of its current non-excluded lines)`. The three cafe-71 invoices specifically:

| Invoice | Before | After |
|---|---|---|
| Sysco 935708 | subtotal $1,585.55, total **$0.00** | subtotal **$1,588.16**, total **$1,588.16** |
| Charlie's Produce 120624947 | subtotal $1,042.80, total **$0.00** | subtotal **$363.33**, total **$363.33** |
| Charlie's Produce TEST-TOFU-002 (the client's literal reported invoice) | subtotal/total both **null** | subtotal **$150.00**, total **$150.00** |

Confirmed the flagged `INV-1001` (`cmqjg1nd6005xji3ulby3cesi`) remains untouched as intended (`subtotalCents: 60100, totalCents: null`) — still needs a human look, not included in the backfill.

Swept for any other invoice still at null/0 total: 22 remain (23 minus `INV-1001`), **all `PENDING_REVIEW`, none `CONFIRMED`** — these were deliberately excluded from the backfill from the start (see the original P0-3 re-verification entry) because they aren't locked records; the fixed `confirm()` logic will correctly auto-fill or block them the next time anyone actually confirms one. No further backfill action needed for those.

**P0-3 is now fully closed**: code fix live in production (confirmed via live backtest), all 16 backfillable stuck-CONFIRMED invoices corrected and re-verified against real data, only the one genuinely-anomalous invoice (`INV-1001`, lines sum to $0) still needs Roshan's manual look.

**Files changed:** none (data-only production fix, no code).
**Commit:** this entry only (docs).
**Verification:** Full before/after re-query against production for all 16 backfilled rows plus a fresh full-table sweep, both shown above.

---

## Five general event-system bugs (affecting ALL workspaces, not just cafe-71)

Investigated first, fixed the clear ones (1, 2, 4), reported scope/decision for the other two (3, 5) rather than guessing. Not deployed — logged for review before Roshan deploys and live-tests.

### BUG 1 — Paid event still displayed "draft" — FIXED

**Root cause:** `markAsPaid()` only ever set `paymentStatus: "PAID"` — the kitchen-lifecycle `status` field (`DRAFT`/`CONFIRMED`/`PREP_IN_PROGRESS`/`IN_SERVICE`/`COMPLETED`/`CANCELLED`) was completely untouched. A payment taken before any kitchen-side confirmation left `status: "DRAFT"`, so the event detail page showed both a "draft" badge (from `status`) and a "Paid" badge (from `paymentStatus`) side by side — contradictory-looking. Worse, the events **list** page only ever rendered `status`, with no payment indicator at all, so a paid event there was visually indistinguishable from an untouched draft.

**Decision made and reported, not silently guessed:** `status` and `paymentStatus` are legitimately two separate axes (kitchen lifecycle vs. money) — that orthogonality is exactly what the P0-4 Dashboard fix depends on ("count paid revenue regardless of status"). So the fix does **not** blanket-advance status on every payment. It specifically advances `DRAFT → CONFIRMED` only, since DRAFT is the one value that reads as "nothing has happened yet" — no longer true once money changes hands. Any event already further along, or `CANCELLED`, keeps its real status untouched; payment never skips or rewinds kitchen-lifecycle progress.

**Fix:** `markAsPaid()` now includes `status: "CONFIRMED"` in its update, conditionally only when `event.status === "DRAFT"`. Also fixed the events list page, which never showed a payment indicator at all — added a "Paid" badge next to the status badge, matching the detail page, so a paid event sitting at a later status (e.g. paid while `IN_SERVICE`) still reads as paid in the list.

**Files changed:** `apps/api/src/events/events.service.ts`, `apps/web/src/app/[workspace]/events/page.tsx`
**Commit:** `6e543d7`
**Verification:** Live-backtested against production (isolated `roshantest` workspace, cleaned up after): a DRAFT event marked paid → `status=CONFIRMED, paymentStatus=PAID`; a `PREP_IN_PROGRESS` event marked paid → `status=PREP_IN_PROGRESS` (untouched), `paymentStatus=PAID`. `pnpm typecheck` clean. **Live test for Roshan**: mark a DRAFT event paid, confirm it now shows "confirmed" + "Paid" (not "draft" + "Paid") on both the detail page and the events list.

### BUG 2 — Same event in both Upcoming and Past tabs — FIXED

**Root cause, NOT the hypothesized timezone/boundary bug:** `EventsService.list()`'s date filter was `if (opts.upcoming) where.startsAt = { gte: new Date() }` — truthy-only. The Past tab sends `upcoming=false`; `if (false)` never runs, so the Past tab applied **no date filter at all** and returned every event in the workspace regardless of date — past and future both. That's why a future event like "smith" appeared in both tabs: Upcoming correctly filtered to future-only, Past filtered to nothing and showed everything.

**Fix:** explicit `opts.upcoming === true` / `=== false` branches — true filters `startsAt >= now`, false filters `startsAt < now`. Omitting the parameter entirely still applies no filter (unchanged for any caller that isn't the two tabs).

**Files changed:** `apps/api/src/events/events.service.ts`, `apps/api/src/events/events.service.spec.ts` (4 new tests)
**Commit:** `739a608`
**Verification:** Live-backtested against production (isolated `roshantest` workspace): created one future-dated and one past-dated event, confirmed each now appears in exactly one tab, never both. `pnpm typecheck` clean, new tests pass. **Live test for Roshan**: open Upcoming and Past tabs side by side, confirm no event appears in both.

### BUG 3 — Quote total inconsistency: labor cost — INVESTIGATED, NOT FIXED, needs a decision

**Found a genuine 3-way conflict in the code, not a simple display bug:**

1. **Create-event page** (`apps/web/.../events/new/page.tsx:368`): `totalCents = subtotalCents + laborTotalCents + markupAmount` — **includes labor**.
2. **`sendQuote()`** (`apps/api/src/events/events.service.ts:1209`), the actual email a real customer receives: `totalCents = subtotalCents + markupAmount + laborTotal` — **includes labor**. Two of three places agree labor is billable.
3. **Saved event detail page's "Quote Summary"** (`apps/web/.../events/[id]/page.tsx:176`): `liveQuoteTotalCents = quoteSubtotalCents + Math.round(quoteSubtotalCents * markupPct / 100)` — **excludes labor entirely**. This is the exact reported discrepancy ($4,414 at creation vs. $3,789 saved — the difference is precisely the $625 labor line).
4. **`computeLiveQuoteTotalCents()`** (`apps/api/src/events/events.service.ts:1278`), the shared backend function that freezes `quotedPriceCents` at `markAsPaid()` time and feeds the public quote page — has an explicit code comment: *"Does NOT include labor: labor is a separate cost line subtracted in the profit calc, not part of revenue."* This is a **deliberate, documented design decision** that directly contradicts what `sendQuote()` actually bills the customer.

**Why this can't be guessed at:** `computeLiveQuoteTotalCents()` is what sets `Event.quotedPriceCents` — the exact field the just-shipped P0-4 Dashboard/Reports work reads as "revenue." If labor should be billable (matching `sendQuote()` and the create page), then every paid event with labor costs has been **undercounting real revenue** in the Dashboard and reports by its labor amount, this whole session's P0-4 work included. If labor should NOT be billable (matching `computeLiveQuoteTotalCents()`'s own comment), then the create page and the actual customer-facing quote email are both wrong and have been overbilling clients for labor that was only ever meant to be an internal cost.

**Question for Roshan, needs an answer before touching any of this:** does the customer's real invoice/quote include labor as billable revenue, or is labor purely an internal cost never charged to the client? Logged in full to `NEEDS_ROSHAN.md` with the exact fix for each of the 4 call sites once decided.

**Files changed:** none — investigation only.

### BUG 4 — Backdated event dates were accepted — FIXED

**Root cause:** zero validation existed anywhere. `CreateEventSchema.startsAt` was just `z.string().datetime()` (any valid ISO timestamp, past or future); `EventsService.create()` had no date check; the frontend's `datetime-local` input had no `min` and no client-side check. Nothing stopped creating an event dated months in the past.

**Rule confirmed before fixing (per instruction):** reject any event whose start date is before today, compared by **calendar day** (not exact instant) — so picking "right now" and submitting a few seconds later is never incorrectly rejected.

**Fix:** `CreateEventSchema.startsAt` now `.refine()`s against a UTC-calendar-day comparison (`isTodayOrFutureUTC`, exported for testing), returning a clear validation error through the existing `ZodValidationPipe`. Frontend: the `datetime-local` input gets a `min` (browser-level picker prevention, best-effort only — a datetime-local value can still be typed by hand past the min) plus a real `handleSubmit` check using the same day-level comparison in the browser's own local time, blocking submit with the same message.

**Files changed:** `apps/api/src/events/events.controller.ts`, `apps/api/src/events/events.controller.spec.ts` (new, 6 tests), `apps/web/src/app/[workspace]/events/new/page.tsx`
**Commit:** `ae0903b`
**Verification:** `pnpm typecheck` (all 9 packages) clean. New tests 6/6 pass. Full API suite 120/123 (same 3 pre-existing unrelated failures). **Live test for Roshan**: try creating an event dated last month — should be blocked client-side with a clear message; if bypassed somehow, the server also rejects it.

### BUG 5 — Send Quote: no email configured, and the fallback link is internal/login-walled — INVESTIGATED, NOT BUILT, scope reported

**(a) "Email not set up" checks `process.env.RESEND_API_KEY`** (`apps/api/src/events/events.service.ts:1167`) — confirmed unset in this environment. This is an API-side secret (per `CLAUDE.md`, would need to be set on Railway, not Vercel).

**(b) The copy-link fallback is genuinely broken, confirmed by reading the code:** `send-quote-button.tsx`'s `copyToClipboard()` uses `window.location.href` — the **current page's own URL**, i.e. the internal `/{workspace}/events/{id}` route, which sits behind the login wall. A client pasted this link gets bounced to a login page for a workspace they have no account in. There is no way to make this link usable without building something new.

**(c) Is a public quote page already built?** No — confirmed via `grep` for every `@Public()` route in the API: the only quote-adjacent public endpoint is `customer-ordering.controller.ts`'s `/orders/quote`, which is a completely different feature (computing a live price quote for a customer placing a food order), not this catering-event quote system. **There is no public, unauthenticated page or route for viewing a specific event's quote today. It needs to be built from scratch.**

**Scope of building it (reported per instruction, not built unattended):**
- A new way to resolve a specific event without requiring login — most likely an unguessable token (new field on `Event`, e.g. `quoteToken`, or a separate table with an expiry) generated when a quote is first sent/copied. **Additive schema change** — would go in `PENDING_MIGRATIONS.sql`, not run, per the standing rule.
- A new **public** (`@Public()`, rate-limited) API route, e.g. `GET /public/quote/:token`, resolving the token to a read-only, redacted view of one event (menu, total, no other tenant data reachable).
- A new **public** Next.js page, e.g. `apps/web/src/app/quote/[token]/page.tsx`, entirely outside the `[workspace]` layout/auth wall, rendering the quote for an external client.
- Updating `sendQuote()`'s email and `copyToClipboard()` to link to this new public page instead of the internal one.
- Security considerations: token unguessability, whether it should expire, whether it should be single-event-scoped only (yes) or allow any mutation (no — read-only).

This is a real, multi-file, security-sensitive feature — not a bug fix. Not built. Logged to `NEEDS_ROSHAN.md` for a scope/priority decision.

**Files changed:** none — investigation only.

**Overall verification for this batch:** `pnpm typecheck` (all 9 packages) clean after every commit. Full API suite 120/123 pass (same 3 pre-existing unrelated failures throughout). Bugs 1 and 2 additionally live-backtested against real production data in an isolated test workspace. Nothing deployed — Roshan will deploy and live-test.

---

## Overnight batch — BUG 3 (decision applied), P1 quick wins, BUG 5 (public quote page)

### BUG 3 — labor now included in the quote total everywhere — FIXED

**Decision applied (made by Roshan): labor IS billed to the customer.** Fixed all 3 conflicting code paths from the prior investigation:

- `computeLiveQuoteTotalCents()` (`apps/api/src/events/events.service.ts`) — the function that freezes `Event.quotedPriceCents` (= revenue for Dashboard/Reports) at `markAsPaid()` time. Added a `laborTotalCents` parameter (defaults to 0, backward compatible), added to the total. `markAsPaid()` now passes `event.laborTotalCents`.
- `MenuSection` (the saved event detail page's "Quote Summary") — previously received **no labor prop at all**; `computedTotal` was menu subtotal + markup only. This was the exact reported bug ($4,414 at creation vs. $3,789 saved). Now takes `laborTotalCents`, includes it in the total, and shows a "Labor" line in the breakdown when > 0.
- `events/[id]/page.tsx`'s `liveQuoteTotalCents` (the Profit/Margin fallback when no persisted revenue exists yet) — same fix.

**Double-count check, done deliberately:** revenue now includes billed labor, and `profit = revenue - foodCost - laborCost` still subtracts the real labor cost exactly once — this is correct "bill for a service, then subtract what it cost to deliver" accounting, not a double-count. Verified this reasoning against `computeMarginPct`'s existing formula, unchanged.

**Live-backtested against production** (isolated `roshantest` workspace, cleaned up after): created an event with a $3,789 menu item, $625 labor, 0% markup — `markAsPaid()` now freezes `quotedPriceCents = $4,414.00`, reproducing the client's exact reported numbers.

**Backfill needed for already-paid events:** swept every `PAID` event workspace-wide for `laborTotalCents > 0` with a frozen `quotedPriceCents` — **exactly 1 affected in all of production** (`cmruvq0p9000i9tkt1x1gpy5v`, "zdvs"), undercounted by $250.00 ($3,789.00 → should be $4,039.00). Guarded backfill SQL (not run) in `NEEDS_ROSHAN.md`.

**Flagged, not in scope:** the frontend's Profit/Margin calc prefers `EventStaffAssignment`-derived labor over the simple `laborTotalCents` estimate when staff assignments exist. This fix and its backfill only touch `laborTotalCents`, matching exactly what the create-page/`sendQuote()` already used. Whether staff-assignment-based labor should *also* be billed to the customer is a separate, bigger question, not guessed at here.

**Files changed:** `apps/api/src/events/events.service.ts`, `apps/api/src/events/events.service.spec.ts` (4 new tests), `apps/web/src/app/[workspace]/events/[id]/menu-section.tsx`, `apps/web/src/app/[workspace]/events/[id]/page.tsx`
**Commit:** `23454b6`
**Verification:** `pnpm typecheck` (all 9 packages) clean. New tests pass. Live backtest against production confirmed exact reported numbers. **Live test for Roshan**: open a paid event with labor cost, confirm the same total shows on the create-page-equivalent view and the saved Quote Summary; check Dashboard revenue reflects the labor-inclusive total for any event paid after this deploys.

### P1-A — shortage estimated cost was ~1000x too small — FIXED

Root cause: the shortage-cost calc in `markAsPaid()` divided by 1,000,000 to go from microcents to cents, but this codebase's actual convention (confirmed in `ingredients.service.ts`'s `updatePrice()` and `insights-generator.worker.ts`) is 1 cent = 1000 microcents. Reproduces the exact report (9 cases × $43.78 showing as $0.39; 2 lb × $7.26 showing as $0.01 instead of ~$14.52) — dividing by 1000x too much destroys nearly all precision before `Math.round()` ever sees the real number.

**Fix:** divide by `1_000` instead of `1_000_000`.

**Live-backtested against production** (isolated `roshantest`, cleaned up after): an ingredient priced at $7.26/lb with a computed shortage — the old formula would show $0.02 (799x too small, same error class as reported); the fixed formula correctly computes $15.98, verified against the raw math (997.9032g × 1601 microcents/g ÷ 1000 = 1597.6 → rounds to 1598 cents).

**Files changed:** `apps/api/src/events/events.service.ts`
**Commit:** `4daa4f9`
**Verification:** `pnpm typecheck` clean. Full API suite unaffected. **Live test for Roshan**: create an event with a real ingredient shortage, confirm the "Est. cost to order" figure on the shortage banner is a plausible dollar amount (roughly `shortage quantity × unit price`), not near-zero.

---

### P1-B — Ingredient categories default to OTHER — INVESTIGATED, decision needed (see `NEEDS_ROSHAN.md`)

Not a simple bug: the only place ingredient category gets assigned automatically (`InvoicesService.confirm()`'s auto-create-unmatched-ingredient path) hardcodes `"OTHER"`. The AI extraction **already detects** a category (the vendor invoice's own section headers — "DAIRY", "MEATS", "PRODUCE", etc.) but it's currently used only for an internal QA reconciliation check and is never persisted or passed through to ingredient creation. Wiring this up needs a genuinely new mapping layer (raw, non-standardized vendor header text → the app's fixed 11-value `IngredientCategory` enum) plus a decision on ambiguous/unmapped cases (e.g. `"MISC CHARGES"`). Full writeup, including what building it would take, in `NEEDS_ROSHAN.md`.

**Files changed:** none — investigation only.

---

### P1-C — Price history dated by invoice date, not upload date; invoice # and previous price now shown — FIXED

Root cause: `IngredientsService.updatePrice()` had no way to specify when a price took effect — `effectiveAt` always fell back to `@default(now())`, so every invoice-sourced price change was dated by whenever it happened to get confirmed in the app, not the invoice's own printed date (already available at the one call site, just never passed through).

**Fix:** `updatePrice()` takes an optional `effectiveAt`; `confirm()` passes `invoice.invoiceDate`. Also addressed the rest of the ask: `IngredientsService.get()` now resolves each `INVOICE`-sourced row's `sourceRef` (an opaque invoice id) to that invoice's actual `invoiceNumber`, and computes each row's previous price from the next-older row. Frontend shows "$X/unit → $Y/unit" and an Invoice # column (vendor and unit were already shown).

**Live-backtested against production** (isolated `roshantest`, cleaned up after): confirmed an invoice with printed date 2026-05-10 (run on 2026-07-21) — the resulting price history row is dated 2026-05-10, with the correct invoice number and `null` previous price (first entry); a second invoice with a different date/price correctly threads `previousPrice` to the prior real price and uses its own date.

**Files changed:** `apps/api/src/ingredients/ingredients.service.ts`, `apps/api/src/invoices/invoices.service.ts`, `apps/web/src/app/[workspace]/ingredients/[id]/IngredientDetailClient.tsx`
**Commit:** `7fa6983`
**Verification:** `pnpm typecheck` clean. **Live test for Roshan**: confirm an invoice, check the ingredient's price history shows the invoice's printed date (not today's date) and the invoice number.

---

### P1-D — Price alerts showed wrong dollar amounts (10x too small) and raw canonical units, no vendor/invoice context — FIXED

Same bug family as P1-A: `detectVendorPriceChange()` converted microcents to dollars via `/1_000_000` instead of the correct `/1000/100`, showing every price alert 10x too small. Also always showed the raw per-canonical-unit price (e.g. per-gram) instead of the ingredient's preferred display unit (e.g. per-lb), and never mentioned which vendor/invoice triggered it.

**Fix:** added a `toDisplayUnitCents()` helper (reuses `toCanonical()` from `@ibirdos/types`, the same conversion pattern already used elsewhere in this codebase) for correct dollars-per-display-unit; alert body now reads e.g. "$5.00/lb to $7.00/lb" and appends "— Vendor Name, invoice #X" when available.

**Noted, not touched:** `detectPriceSpikes()` in `insights-generator.worker.ts` (the other price-alert generator, period-over-period trend detection) already had the correct `/1000/100` conversion — only `detectVendorPriceChange()` had the wrong divisor. It does have a cruder hardcoded gram→lb conversion rather than the ingredient's actual `preferredDisplayUnit`; flagged as a smaller follow-up, not fixed since it wasn't reported broken.

**Live-backtested the full pipeline against production** (isolated `roshantest`, cleaned up after): two invoices for the same ingredient with a 40% price jump produced an insight body reading exactly `"... increased from $5.00/lb to $7.00/lb (40.0% increase) — P1D Backtest Vendor, invoice #P1D-002."`

**Files changed:** `apps/api/src/insights/rules/vendor-price-change.rule.ts`, `apps/api/src/insights/rules/vendor-price-change.rule.spec.ts` (4 new tests, 6 existing updated), `apps/api/src/invoices/invoices.service.ts`
**Commit:** `6e78ca8`
**Verification:** `pnpm typecheck` clean. 10/10 tests pass in the updated spec file. **Live test for Roshan**: confirm two invoices for the same ingredient with a >15% price jump, check the resulting price-change alert shows a correct dollar amount in the ingredient's display unit, with vendor and invoice # mentioned.

---

### BUG 5 — public quote page — BUILT (schema pending, feature inert until migration runs)

Full build per the decision to proceed: schema (additive, NOT applied — see `PENDING_MIGRATIONS.sql`), a `@Public()` rate-limited API route, a public Next.js page outside the `[workspace]` auth layout, and updated `sendQuote()`/"Copy quote & link" to use it.

**Why the schema change isn't in `schema.prisma` yet, even though it's additive:** Railway's build step runs `prisma generate` on every deploy, and Prisma's generated client issues an explicit column list per query (not `SELECT *`) — adding `quoteToken` to `schema.prisma` before the column exists in the actual database would break **every** query against `Event`, not just quote-token ones, the moment this deploys. So the new `quote-token.service.ts` accesses this column via raw SQL only, and treats a query failure (column missing) as "feature not enabled yet." This makes the whole feature genuinely inert until the migration runs — confirmed live against production (below), not just reasoned about.

**Security model, proven not just asserted:** `quoteToken` is a 256-bit crypto-random hex string (same generation as this app's own CSRF tokens), resolved by exact-equality lookup only. `quote-token.service.spec.ts` (8 tests, simulated two-tenant table) proves: token A resolves only to event A's data, token B only to event B's; a well-formed-but-unregistered token returns null, not another event's data; a strict prefix of a real token does NOT match (proves exact equality, not `LIKE`/`startsWith`); an empty/short token is rejected before ever querying the database; a workspaceId/eventId mismatch cannot mint or fetch another workspace's token. The public route itself scopes every downstream query (menu items, workspace name) by the already-resolved single event's own id/workspaceId — never by request input.

**Dead-link handling:** a cancelled event's quote returns the same 404 as an unrecognized token (no distinction leaked).

**Live-verified against real production** (isolated `roshantest` workspace): confirmed the graceful-degradation path actually fires today — Postgres error `42703` ("column quote_token does not exist"), caught, returns `null`, event data left completely untouched. This is proof the feature is inert right now, not just inert-in-theory.

**Incidental fix:** discovered and fixed a pre-existing gap in `apps/api/vitest.config.ts` — the `@ibirdos/config` alias pointed at a directory with no `index.ts` (unlike every other aliased package), so any spec file importing it had always been broken under vitest; this session's changes were just the first to actually exercise that import path. Pointed the alias at the one file the package has (`env.ts`).

**Files changed:** `PENDING_MIGRATIONS.sql` (new), `apps/api/src/events/{quote-token.service.ts, quote-token.service.spec.ts, public-quote.controller.ts}` (new), `apps/api/src/events/{events.service.ts, events.controller.ts, events.module.ts}`, `apps/api/vitest.config.ts`, `apps/web/src/app/quote/[token]/page.tsx` (new), `apps/web/src/app/[workspace]/events/[id]/send-quote-button.tsx`
**Commit:** `0626f4d`
**Verification:** `pnpm typecheck` (all 9 packages) clean. Full API suite 136/139 (same 3 pre-existing unrelated failures). `quote-token.service.spec.ts` 8/8 pass. **NOT deployed. Schema migration NOT run** — this needs Roshan to (1) run the SQL in `PENDING_MIGRATIONS.sql`, (2) add the noted field to `schema.prisma` and re-run `prisma generate` as a follow-up for cleaner typed access, (3) deploy, (4) live test: mark an event's quote as sent (or click "Copy quote & link"), open the resulting `/quote/{token}` link in an incognito window with no session, confirm it shows only that event's quote with no login prompt.

---
