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
