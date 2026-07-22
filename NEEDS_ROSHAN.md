# Needs Roshan — decisions / risks / things I will not guess on

---

## P1-14 — reorder-threshold suggestions — BLOCKED ON DATA, not built

**Not a decision to make — a data gap.** Queried real production: only **3 ingredients in the entire database** have ever had a `CONSUME` inventory transaction, out of 2,624 active ingredients, and all three are from this session's own backtests (URGENT-1/P0-2 debugging), not real client usage. Consumption only started recording *correctly* as of the URGENT-1 fix (shipped today, 2026-07-22) — before that, the kitchen auto-consume path silently failed on any shortage, so there's effectively no real historical usage-rate data yet, at any point before today.

The standard, defensible reorder-point formula (average daily usage × lead time) needs exactly the data that doesn't exist. Building it now would mean inventing a formula dressed up as data-driven, which you correctly flagged as worse than no suggestion at all.

**Path forward:** revisit this once a few weeks of real kitchen usage have accumulated post-URGENT-1-fix (rough rule of thumb: enough CONSUME transactions per ingredient, spanning enough calendar time, that an average isn't dominated by noise — I'd want to see meaningfully more than the "1-2 data points" state production is in today before trusting any formula). Purchase/RECEIVE data is healthy in the meantime (606 ingredients have 2+ receives) if you ever want a rougher, clearly-labeled "percentage of typical order size" heuristic as a stopgap — flagged as an option, not built, since you didn't ask for it as a fallback.

---

## P1-8 — "Goal food cost %" and "Target margin %" are two independent targets that can silently disagree

Fixed the labeling/clarity part (see `FIX_LOG.md` "P1-8") — that was a real, worthwhile improvement regardless of what follows. But investigating this surfaced something bigger than labels, which I'm flagging rather than fixing myself, per your instruction: this may be a genuine design issue, not just poor copy.

**Actual current behavior, confirmed by reading the code (not guessed):**
- **"Target margin %"** is a real input that *drives* pricing — but only when "Auto-reprice" is on. In that mode, the sell price is solved backwards from this number (`sellPrice = portionCost / (1 - margin%/100)`); the user never types a price at all.
- **"Goal food cost %"** is a *completely separate* input. It never affects pricing in either mode — it only (a) colors "Actual food cost %" red/green, and (b) suggests a "min sell price" figure that's only relevant if Auto-reprice is off and you're pricing manually.
- **Nothing reconciles the two.** A user can set "Goal food cost %" to 20% and "Target margin %" to 50% — genuinely incompatible numbers (a 50% margin implies roughly 50% food cost, not ≤20%) — and the app will happily auto-price to hit the 50% margin, then color the resulting "Actual food cost %" **red**, flagging a number that the user's *own other setting* just produced. There's no warning that the two targets disagree, and no indication that "Target margin %" is the one that actually wins for pricing purposes.

**What I did:** relabeled both fields with plain-language helper text explaining which is input vs. derived and which one actually sets the price (see the diff) — this makes the *current* behavior legible, but doesn't change it.

**What I didn't do, because it's a real product call:** decide whether these should be reconciled. Options, roughly in order of how much they'd change:
1. Leave as two independent knobs (current, now just better-labeled) — accept that they can disagree, on the theory that "goal food cost %" is more of a reporting/compliance target and "target margin %" is the operational pricing lever, and that's fine.
2. Warn inline when the two imply meaningfully different numbers (e.g. "Your target margin implies ~48% food cost, above your 20% goal") — smallest behavior change, no pricing logic touched.
3. Collapse to a single target field with a food-cost/margin toggle (they're two views of the same number: `margin% ≈ 100% - foodCost%`, modulo paper cost) — bigger UX change, removes the possibility of disagreement entirely but is a real redesign of this card.

Let me know if you want option 2 or 3 built, or if option 1 (labels only, already shipped) is enough.

---

## P1-6/P1-7 — should editing an ingredient's name from the recipe page rename it everywhere?

Fixed the actual bugs (see `FIX_LOG.md` "P1-6/P1-7") without guessing on this part. The saved recipe page's ingredient editor had a "Name" field that PATCHed `{name: ...}` to the recipe-ingredient endpoint — but `name` isn't a `RecipeIngredient` column at all; it's the shared `Ingredient` record's name, used by every other recipe, invoice, and inventory record that references it. Wiring that up as written would have meant "fix a typo while looking at one recipe" silently renames the ingredient everywhere.

I made it read-only here (links out to the ingredient's own edit page instead) rather than build a global-rename side effect I wasn't sure was wanted. If you DO want inline rename-from-recipe-page to work, it's a small, well-scoped addition (route the "name" patch to `IngredientsService.update()` using `line.ingredientId` instead of the recipe-ingredient endpoint) — let me know and I'll wire it up.

---

## Outstanding-shortage ledger — auto-resolve-on-receive fast-follow (not built, flagged not guessed)

Built exactly as approved: immutable row per shortfall, manual "Mark resolved" action, live read-only "stock now sufficient" badge. Deliberately did NOT build auto-resolve-on-receive (a shortage row automatically clearing itself the moment enough stock arrives) — you flagged the risk yourself (recreating the exact recompute-and-lose-history trap this whole feature exists to avoid), and I agree it needs real design, not a quick hook.

If/when you want it: the honest version isn't "hook `RECEIVE` transactions and auto-clear" (too blunt — a RECEIVE for a *different* event's needs shouldn't silently resolve *this* event's shortage, and partial receives need partial-resolve semantics) — it's closer to a small reconciliation job that, on each `RECEIVE`, checks unresolved rows for that ingredient ordered oldest-first and offers/auto-applies against them specifically, still leaving the row itself immutable (add a `stockReceivedCanonical` running counter rather than mutating `shortCanonical`). That's real design + a queue/worker touchpoint, not a fast patch — let me know if/when you want to scope it.

---

## URGENT-1 — should shortage-consumption be allowed to go negative instead of deduct-to-zero?

**Fixed the actual bug (kitchen tasks silently consuming nothing on shortage) without guessing on this part** — see `FIX_LOG.md` "URGENT-1". Current shipped behavior: on a shortage, consume whatever stock IS available and floor at zero, recording the shortfall in the transaction note and audit metadata. Stock never goes negative.

The alternative — let the CONSUME transaction take stock negative, preserving the exact shortfall magnitude (e.g. `-931.5 lb` instead of floored `0`) — is more information-preserving (matches how the app's own shortage-detection feature already reports deficits as negative numbers elsewhere) but is a bigger-blast-radius change: it assumes every other place that reads `currentStockCanonical` (low-stock alerts, "in stock" badges, reorder-threshold comparisons, CSV exports) tolerates a negative value without breaking or displaying something confusing. I didn't audit all of those for negative-safety, so I didn't default to it.

If you want negative stock instead (more honest shortfall tracking, but needs that broader audit first), let me know and I'll do the audit + switch it over. Otherwise, deduct-to-zero (current, shipped) stands.

**Also flagged, not a decision needed, just context:** the real production event that surfaced this ("22smith", workspace `roshancafe99999`, Beef Sirloin Tri Tip) has its PREP task already marked DONE with zero consumption ever recorded (confirmed via direct query — no CONSUME transaction exists for that task). Because no transaction was ever written, the task-level idempotency guard won't block a retry: once this fix is deployed, toggling that task DONE → PENDING → DONE again will correctly backfill the (now-shortage-aware) consumption for that event. No manual SQL needed for this one — just re-run it through the UI once deployed.

---

## BUG C — Should Chef be able to log inventory write-offs at all? — RESOLVED

**Resolved 2026-07-21: keep as implemented.** Decision: Chef's write-off/waste-logging ability (`waste.create`) stays — a chef logging spoilage is legitimate kitchen work. Receive and Recount (`inventory.adjust`) stay blocked for Chef/Staff. No change needed; the shipped implementation is correct.

---

## BUG D — Fix applied, but I couldn't fully reproduce your exact example from code

I found and fixed one concrete, verified inconsistency: the API (Railway) and web app (Vercel) are two separate processes, and the API was independently formatting `event.startsAt` for notification/email text with no explicit timezone — while the web app also had no explicit timezone. If those two containers' ambient defaults ever differed, the same timestamp could render differently between "a notification/email" and "the actual web pages." Pinned both sides to explicit UTC, which structurally guarantees they now agree.

**What I can't confirm:** your example was a full date/month difference ("Nov 10, 8:42 PM" vs "7/20/2026"), and every mechanism I found in the code only explains up to a ~1-day shift near midnight, not months. I don't have a way to reproduce the "smith" event's actual data to check further.

**Please re-check live once this is deployed** — pull up the same event's detail page, kitchen prep list, kitchen service list, and events list side by side. If they now all agree, the fix covered it. If they still don't, that's a genuine data issue I haven't found (possibly something specific to that one event's data, or a bug outside what I checked) — send me the exact event and the two screens/URLs you're comparing and I'll dig further with real repro info instead of guessing at mechanisms.

---

## P0-1 follow-up — "Chef, and per client also Manager where applicable" — RESOLVED

**Resolved 2026-07-21: no change needed.** Confirmed with Roshan — the client's scope only specified Chef and Staff for financial restriction, not Manager. The implementation shipped (`canViewFinancials(role)`, true for OWNER/MANAGER, false for CHEF/STAFF/CUSTOMER) is exactly correct as-is. Manager keeps full financial access across recipes, ingredients, inventory, and events, same as Owner.

---

## P0-1 — Chef/Staff financial-visibility rule: full endpoint list for live Chef-account testing

Applied your rule precisely: operational fields stay, financial fields (cost/price/margin/vendor/price-history/revenue/profit) are stripped from JSON for endpoints Chef legitimately calls, and purely-financial endpoints/pages stay 403'd. **No ambiguous cases came up this round** — every gap found was a clear "this field is a dollar amount, strip it" case, consistent with the redaction pattern already established elsewhere in the code, so nothing is being guessed at or deferred here.

**Before writing any of these, confirmed in `packages/permissions/src/index.ts` that `canViewFinancials()` (the function every fix below gates on) returns `true` for OWNER and MANAGER and `false` for CHEF/STAFF/CUSTOMER — it's the same signal already used throughout the codebase, not a new check, so Owner/Manager behavior is structurally unchanged by any of these fixes (every fix is `if (!canViewFinancials(role)) { strip }`, meaning the `true` branch — Owner/Manager — always returns the original, full data).**

### Endpoints fixed this round (field-stripped — Chef/Staff still get a 200, with financial fields removed/nulled)

| Endpoint | Permission required (unchanged) | What was stripped | What Chef/Staff still sees |
|---|---|---|---|
| `GET /kitchen/tasks/:id` | `kitchen.read` | Embedded recipe's `salePriceCents`, `goalFoodCostPct`, `paperCostCents`, `cachedCostMicrocents`, `cachedCostPerPortionMicrocents`, `cachedCostUpdatedAt`, `costStaleness`, `costComputeError`, `cachedMarginPct`, `cachedMarginCents`, `targetMarginPct` | Recipe name, instructions, prep/cook time, full ingredient list with quantities |
| `GET /events`, `GET /events/:id` | `event.read` | **(new, on top of the existing redaction)** `menuItems[].unitPriceCentsAtAdd`/`unitPriceCentsOverride`; `kitchenPacket.tasksJson[].totalCostMicrocents`; `inventoryShortages[].vendorId`/`lastUnitPriceCents`/`estCostCents` | Event name, guest count, timing, menu items (recipe name/portions, no price), kitchen tasks, **shortage quantity/gap per ingredient** (`neededCanonical`/`haveCanonical`/`shortCanonical`) — this is the "show 10 lb short, not the $ estimate" rule applied directly |
| `POST /yield-waste/waste` | `waste.create` | `costMicrocents` on the created entry | The entry itself (ingredient, quantity, reason, notes) |
| `GET /yield-waste/waste` | `waste.read` | `costMicrocents` per entry | Same list, ingredient/quantity/reason per entry |
| `GET /yield-waste/waste/target-report` | `waste.read` | `totalCostCents`, `targetCostCents`, `overTarget`, per-reason `costCents` (all set to `null`) | `byReason[].count` and `.qtyCanonical` — which reasons cause the most waste, by quantity |
| `GET /yield-waste/waste/event-impact` | `waste.read` | Per-event `costCents` (set to `null`) | `eventName`, `startsAt`, `wasteCount` per event |

### Endpoints already correct before this round (re-confirmed, not re-touched)

Everything from the P0-1 audit table in `FIX_LOG.md` — recipes, ingredients, inventory transactions, `/invoices`, `/reports` + `/reports/vendor-aging`, `/billing/subscription`, `POST /recipes/extract` (fixed in the prior round). Also explicitly re-checked this round and found clean: `GET /kitchen/tasks` (board view — `KitchenTask` has no cost columns), `PATCH /kitchen/tasks/:id`, all `yield.*`-gated endpoints (yield has no cost dimension), every `events.controller.ts` write route (`event.create`/`event.update`/`event.delete`/`event.assign_staff` — none held by Chef/Staff, so not reachable at all), `users`/`notifications`/`uploads`/`workspaces` controllers.

### Frontend page guards — unchanged, still correct

`/invoices`, `/reports` (including `/reports/vendor-aging`) still 403/redirect via `apps/web/src/app/[workspace]/{invoices,reports}/layout.tsx`'s `requireRole(["OWNER","MANAGER"])` — no code touched here this round, confirmed still in place.

### What to test as Chef on `cafe-71`

1. Open a kitchen task detail (`/kitchen/[taskId]` or the task-detail API) for a task linked to a recipe with a real sale price/cost set — confirm the recipe name/instructions/ingredients show, but no cost/price/margin number appears anywhere (check Network tab, not just the UI, in case a number is fetched but not rendered).
2. View a paid event with a known ingredient shortage — confirm the shortage shows as a quantity (e.g. "short 9 lb"), with no `$` figure next to it, in both the UI and the raw `GET /events/:id` response.
3. Log a waste entry (`POST /yield-waste/waste`) — confirm the response/confirmation doesn't show a $ value.
4. View the waste list and (if there's a Chef-visible waste report page) the target-report/event-impact views — confirm counts/quantities show, dollar totals don't.
5. **Cross-check as Owner or Manager**: same kitchen task, same event, same waste views — confirm cost/price/margin/$ figures all still show exactly as before. If any of these went missing for Owner/Manager, that's a real bug — flag it back.

---

## P0-1 — Live Chef-account verification checklist (both audit-found gaps now fixed in code — needs a real Chef login to confirm)

No decision needed here — both fixes were unambiguous (checked the permission matrix before applying either one; see FIX_LOG.md "P0-1 FIX" for the exact roles-granted-access check). This is purely the test list you asked for: log in as a CHEF-role user on workspace `cafe-71` and run through these. Everything else the original P0-1 audit checked was already protected pre-existing code and doesn't need re-testing here (it's covered by the audit table in FIX_LOG.md).

**1. `POST /recipes/extract` — the ingredient-cost leak during recipe extraction**
- Permission required to reach the endpoint at all: `recipe.create` (Chef holds this — intentional, chefs propose recipes, so Chef should still be able to use the extract feature).
- What changed: the `matchedCostCents` field on each returned ingredient.
- Test: as Chef, go to Recipes → New/Import → upload a recipe photo (or a CSV/XLSX with ingredient names that match existing ingredients that have a cost set). Check the raw API response (browser DevTools → Network tab → the `/recipes/extract` request) for each matched ingredient line.
  - **Expected now:** `matchedCostCents` is `null` for every line, even when the ingredient it matched to has a real cost in your database.
  - **Should still work:** `matchedName`, `ingredientId`, `matchedDimension`, `matchedCanonicalUnit`, `matchedDensityGPerMl` are all still populated — Chef should still see which existing ingredient each line matched to, just not its cost.
  - **Cross-check as Owner or Manager:** same upload, same request — `matchedCostCents` should still show the real value (not null). If it's null for Owner/Manager too, that's a bug in the fix, not the intended behavior.

**2. `GET /billing/subscription` — wrong permission gate**
- Permission required now: `billing.read` (was `workspace.read`).
- Test: as Chef, this isn't reachable through any UI (the `/billing` page already blocked Chef client-side, and the sidebar never showed a Billing link for Chef) — so the only way to actually test this one is a direct API call, e.g. from DevTools console while logged in as Chef: `fetch('/api/v1/billing/subscription', {credentials: 'include'})` (adjust the path prefix to match your actual API base) and confirm you get a `403 Forbidden`, not a 200 with subscription data.
- **Cross-check as Owner or Manager:** log in as each, visit `/billing` normally — the page should load and show the real plan/subscription exactly as before (this must not regress; Manager access was the specific thing double-checked before applying this fix).

**If either check comes back wrong (Chef sees data that should be hidden, or Owner/Manager gets blocked from something that worked before), that's a real bug in my fix — flag it back rather than working around it in the UI.**

---

## P0-1 — Vercel deployment commit not independently verifiable

I confirmed the Railway API deployment exactly matches local repo HEAD (`f1b3822`, verified via `railway status --json` deployment metadata — commit hash, author, and message all match). I do **not** have working Vercel access in this session (no CLI/API auth available non-interactively), so I cannot confirm the deployed web bundle is also on `f1b3822`.

This isn't blocking my P0-1 work (the vulnerability is real in the current repo code regardless of which frontend build is live), but if Chef's reported access predates today and doesn't match what the fix addresses, it's worth checking manually: Vercel dashboard → project → Deployments → confirm the current production deployment's commit hash is `f1b3822` or later.

**No action needed from you unless the fix below doesn't resolve what you're seeing in the live app.**

---

## P0-2 — SQL to find + reverse the duplicate CONSUME transactions (DO NOT run without checking first — I have no live DB access, so this is a template, not a verified fix for your exact rows)

Root cause (fixed in code, see FIX_LOG.md P0-2): an event marked COMPLETED ran a bulk recipe-based inventory consume for the *entire* event, with no check for whether its kitchen tasks had *already* consumed the same ingredients when marked DONE. Any event that used both the kitchen-task board and got marked COMPLETED double-deducted every ingredient in its menu. The code now guards against this (skips the bulk consume if kitchen-task consumption already ran, and guards each path against re-firing on itself), but that doesn't undo whatever double-deduction already landed in your data.

**Step 1 — find candidate duplicate pairs** (read-only, safe to run any time):

```sql
-- Finds ingredients where an "Event"-sourced CONSUME and a "KitchenTask"-sourced
-- CONSUME both landed for the same event, close together in time — the double-
-- deduction signature. Adjust the interval if your kitchen tasks and event
-- completion are typically further apart than 24h.
SELECT
  e.id            AS event_id,
  e.name          AS event_name,
  it_event.ingredient_id,
  ing.name        AS ingredient_name,
  it_event.id     AS event_tx_id,
  it_event.quantity_canonical AS event_tx_qty,
  it_event.created_at AS event_tx_at,
  it_task.id      AS kitchen_task_tx_id,
  it_task.quantity_canonical  AS kitchen_task_tx_qty,
  it_task.created_at  AS kitchen_task_tx_at
FROM inventory_transactions it_event
JOIN events e
  ON e.id = it_event.source_ref AND it_event.source_kind = 'Event'
JOIN kitchen_tasks kt
  ON kt.event_id = e.id
JOIN inventory_transactions it_task
  ON it_task.source_ref = kt.id
  AND it_task.source_kind = 'KitchenTask'
  AND it_task.ingredient_id = it_event.ingredient_id
  AND it_task.kind = 'CONSUME'
JOIN ingredients ing ON ing.id = it_event.ingredient_id
WHERE it_event.kind = 'CONSUME'
  AND it_event.workspace_id = '<WORKSPACE_ID cafe-71>'
ORDER BY e.id, it_event.ingredient_id;
```

**Step 2 — reverse it, once you've confirmed which rows are the real duplicates.**

Do **not** delete the erroneous `inventory_transactions` rows — that destroys the audit trail (created_by, timestamps, cost basis) and `balance_after_canonical` on every later row for that ingredient would then be wrong too. Instead insert an **offsetting `ADJUST` transaction** that restores the stock the double-deduction wrongly removed, referencing the bad transaction for traceability:

```sql
-- Run ONCE per confirmed-duplicate (ingredient_id, event_id) pair from Step 1.
-- Replace <INGREDIENT_ID>, <WORKSPACE_ID>, <BAD_TX_ID>, <QTY_TO_RESTORE> (positive
-- number, canonical units — same magnitude as the erroneous CONSUME you're reversing).
BEGIN;

INSERT INTO inventory_transactions (
  id, workspace_id, ingredient_id, kind,
  quantity_canonical, balance_after_canonical,
  source_kind, source_ref, notes, created_at
)
SELECT
  gen_random_uuid()::text,
  '<WORKSPACE_ID>',
  '<INGREDIENT_ID>',
  'ADJUST',
  <QTY_TO_RESTORE>,
  current_stock_canonical + <QTY_TO_RESTORE>,
  'Manual',
  '<BAD_TX_ID>',
  'Correction: reverses duplicate CONSUME <BAD_TX_ID> from event-complete + kitchen-task double-trigger bug (fixed in code 2026-07-20)',
  now()
FROM ingredients WHERE id = '<INGREDIENT_ID>';

UPDATE ingredients
SET current_stock_canonical = current_stock_canonical + <QTY_TO_RESTORE>
WHERE id = '<INGREDIENT_ID>';

COMMIT;
```

I'm intentionally not filling in the real IDs/quantities — I don't have a connection to the live prod database from this session, so I can't identify or verify the actual duplicate rows. Please run Step 1 yourself, confirm each pair really is the double-deduction (matching quantities, same event, close timestamps), then run Step 2 per row.

---

## P0-3 — Should DISCOUNT-category invoice lines subtract from the total?

Your bug description says the invoice total should be "lines + tax + fees − credits." I implemented the auto-recalc and reconciliation-blocking (see FIX_LOG.md P0-3) using a flat sum of all non-excluded lines — which is the **one convention that already existed** in the code before my fix (the reconciliation banner on the invoice detail page summed lines the same way). I did not make `DISCOUNT`-category lines subtract, because:

- `InvoiceLineCategory` already has a `DISCOUNT` value, but nothing anywhere in the app — not `confirm()`, not the existing reconciliation UI, not the zod validation schemas — treats it specially today.
- `extendedPriceCents` is enforced **non-negative** on every line (`CreateLineSchema`), so there's no existing way to enter a discount as a negative amount. A $15 discount line, if you flip its sign in the total math, would need to be entered as "$15" but subtracted — which is a UX/validation decision, not just a math one.

Options, roughly in order of how much they'd change:
1. **Leave as-is** (current state after my fix): all lines add, including anything marked DISCOUNT. Reviewer has to manually adjust the Total field to account for a discount, and the reconciliation check will then correctly hold them to that manually-entered number.
2. **Auto-subtract DISCOUNT lines**: change `sumInvoiceLineCents` to subtract lines where `category === "DISCOUNT"` instead of adding them. Low-risk, but changes what the computed subtotal means for anyone who's already using DISCOUNT lines today (if anyone is — I didn't find evidence either way).
3. **Allow negative `extendedPriceCents` for DISCOUNT lines specifically**: bigger schema/UX change, touches the AI extraction path too (what does the extractor emit for a discount line today?).

Let me know which you want and I'll implement it — didn't want to guess at a change that touches how real vendor invoice totals get computed.

---

## P0-4 — Daily Sales and most Reports are structurally disconnected from Events (not a filter bug — there's no pipe at all)

Per your instructions I'm reporting this disconnect before building anything, since fixing it means picking a data model, not just fixing a query.

**What I already fixed (mechanical, low-risk, done — see FIX_LOG.md P0-4):**
- `AnalyticsService.eventStats()` (feeds the Dashboard's Revenue/Food-cost/Margin tiles) was filtering events by kitchen-lifecycle `status: { in: ["COMPLETED", "IN_SERVICE"] } `instead of `paymentStatus: "PAID"`. A paid event sitting at any earlier status (e.g. `CONFIRMED`, waiting on its event date) was invisible to the Dashboard even though `markAsPaid()` had already frozen its revenue. Changed the filter to `paymentStatus: "PAID"` (excluding `CANCELLED` regardless of payment status). This is very likely the direct cause of the $312.50 event you saw not showing up.
- `markAsPaid()` also wasn't calling `rollupCosts()` after freezing revenue, so `computedMarginPct`/`computedLaborCostCents` (read directly by the Dashboard and by the `low-margin-events`/`catering-vs-events` reports) could still reflect stale/null revenue right after payment. Now recomputed in the same call.

**What I did NOT touch, because it's a bigger decision:**

`GET /reports/food-cost-vs-sales`, `/reports/labor-cost-vs-sales`, `/reports/prime-cost`, and `/reports/sales-by-period` — plus the entire `/daily-sales` page — read **exclusively** from the `daily_sales` table (`ReportsService`, every method: `prisma.dailySales.findMany(...)`). That table is populated by ONE thing: a human manually typing in a day's POS numbers (gross/net sales, tax, tender breakdown) on the Daily Sales page. **There is no code anywhere that creates or updates a `DailySales` row from an Event.** So even after my fix above, a paid catering event's revenue will show up on the **Dashboard** (reads `Event.quotedPriceCents` directly) and on the **`low-margin-events`/`catering-vs-events` reports** (same), but will still show **$0 on the Daily Sales page and on food-cost/labor-cost/prime-cost/sales-by-period reports**, because those were never wired to Events at all — not a bug, a feature that was never built.

Wiring this needs a decision, because `DailySales` isn't just a number — it's a POS-reconciliation record with its own semantics (gross vs net, tax, discounts, voids, refunds, a `tenders` breakdown, and a `variance` check comparing `netSales` against the sum of tenders). Options:

1. **Auto-inject event revenue into that date's `DailySales` row** (create one if it doesn't exist, add to it via the existing merge/"add" logic if it does — `DailySalesService.create(..., mode: "add")` already supports this). Simplest to wire, but: mixes two different revenue sources into one row with no way to tell them apart later, and would silently corrupt the `variance` check (a manually-entered day's tenders would no longer sum to `netSales` once event revenue is added on top with no matching tender entry) for any workspace that also runs a POS.
2. **Give `DailySales` (or a new lightweight join table) an explicit link back to the source event(s)** contributing to that date, so event-sourced and POS-sourced revenue are both visible on the same day but distinguishable and the variance check can be corrected to exclude event revenue. More correct, more work — touches the `DailySales` schema (additive column/table, fine under your migration rule) and the variance calc.
3. **Keep them as genuinely separate revenue streams and change the *reports* (not the data) to sum both `dailySales.netSales` and `event.quotedPriceCents` for the period**, rather than merging at the data layer. No schema change, no risk to the existing Daily Sales / variance feature, but every report that currently reads only `dailySales` needs a second query added (`getFoodCostVsSales`, `getLaborCostVsSales`, `getRentVsSales`, `getPrimeCost`, `getSalesByPeriod` — 5 methods) — mechanical but not small, and "sales by period" would need per-day/week/month event bucketing to match the existing granularity logic.

I'd lean toward option 3 (least risk to the live POS-reconciliation feature, most explicit), but that's a real product call — does this workspace even use the Daily Sales / POS feature for anything besides catering, or is `cafe-71` catering-only, in which case option 1 or 2 might be exactly right and simpler. Let me know which direction and I'll build it.

---

## P0-2 — safe SQL to reverse the existing duplicated Tofu/Asparagus consumption

**Not run.** This is a live production data correction — you asked for the SQL, not for me to execute it. Verified against the current state of `cafe-71` (workspace `cmq8woxqi0007q0u7zxgfab5q`) as of the backtest that confirmed this bug, re-checked immediately before writing this section — nothing has changed since (current `ingredients.current_stock_canonical` for both rows still exactly matches the *second* (duplicate) CONSUME transaction's `balance_after_canonical`, and no transaction of any kind exists after it), so it's safe to reverse with simple arithmetic, no reconstruction needed.

**The two duplicate pairs** (both against event "Test Event", `id=cmrs4hn1500jf9uv8ywaqe6wn`, status `DRAFT` — this is the same event the investigation traced the bug to, not the client's real "smith" event):

| Ingredient | Legitimate txn (PREP task, keep) | Duplicate txn (SERVICE task, reverse) | Current stock | Corrected stock |
|---|---|---|---|---|
| Tofu, Extra Firm Org/C (`cmrs1s21j00gc9uv8a3uj07m4`) | `cmrs4ryij00jz9uv8n51u4tgo`, −11339.8 g, balance 15875.72 g | `cmrs4ssyx00kd9uv88qu2fb66`, −11339.8 g, balance 4535.92 g | 4535.92 g | **15875.72 g** |
| Asparagus, Large (Contract) (`cmrs1s26a00hw9uv85iflyp6h`) | `cmrs4ryix00k39uv8vf4rwox2`, −2267.96 g, balance 2721.552 g | `cmrs4ssz600kh9uv85kcrebth`, −2267.96 g, balance 453.592 g | 453.592 g | **2721.552 g** |

Net correction: **+11339.8 g Tofu, +2267.96 g Asparagus** — i.e. add back exactly what the SERVICE-task duplicate wrongly subtracted a second time.

**Recommended approach — insert a compensating `ADJUST` transaction, don't delete history.** Deleting the duplicate `CONSUME` row would erase the audit trail of what actually happened (a real bug did real damage; that should stay visible). Inserting a positive `ADJUST` transaction that references the row it's correcting keeps a clean, honest ledger. Run both statements from one `psql` session (or wrap in `BEGIN; ... COMMIT;`) so the transaction row and the balance update land atomically — this mirrors exactly what `InventoryService.recordTransaction` does in code, just by hand:

```sql
BEGIN;

-- Tofu: reverse the SERVICE-task duplicate (cmrs4ssyx00kd9uv88qu2fb66)
INSERT INTO inventory_transactions
  (id, workspace_id, ingredient_id, kind, quantity_canonical, balance_after_canonical,
   source_kind, source_ref, notes, created_at, created_by_id)
VALUES
  (gen_random_uuid()::text, 'cmq8woxqi0007q0u7zxgfab5q', 'cmrs1s21j00gc9uv8a3uj07m4', 'ADJUST',
   11339.8, 15875.72, 'Manual', 'cmrs4ssyx00kd9uv88qu2fb66',
   'P0-2 correction: reversing duplicate CONSUME cmrs4ssyx00kd9uv88qu2fb66 (SERVICE-task double-fire on same recipe as PREP task cmrs4ryij00jz9uv8n51u4tgo, event cmrs4hn1500jf9uv8ywaqe6wn) -- see FIX_LOG.md P0-2',
   now(), NULL);

UPDATE ingredients
  SET current_stock_canonical = 15875.72, updated_at = now()
  WHERE id = 'cmrs1s21j00gc9uv8a3uj07m4' AND current_stock_canonical = 4535.92;

-- Asparagus: reverse the SERVICE-task duplicate (cmrs4ssz600kh9uv85kcrebth)
INSERT INTO inventory_transactions
  (id, workspace_id, ingredient_id, kind, quantity_canonical, balance_after_canonical,
   source_kind, source_ref, notes, created_at, created_by_id)
VALUES
  (gen_random_uuid()::text, 'cmq8woxqi0007q0u7zxgfab5q', 'cmrs1s26a00hw9uv85iflyp6h', 'ADJUST',
   2267.96, 2721.552, 'Manual', 'cmrs4ssz600kh9uv85kcrebth',
   'P0-2 correction: reversing duplicate CONSUME cmrs4ssz600kh9uv85kcrebth (SERVICE-task double-fire on same recipe as PREP task cmrs4ryix00k39uv8vf4rwox2, event cmrs4hn1500jf9uv8ywaqe6wn) -- see FIX_LOG.md P0-2',
   now(), NULL);

UPDATE ingredients
  SET current_stock_canonical = 2721.552, updated_at = now()
  WHERE id = 'cmrs1s26a00hw9uv85iflyp6h' AND current_stock_canonical = 453.592;

COMMIT;
```

Notes:
- The `WHERE current_stock_canonical = <expected current value>` guard on both `UPDATE`s is a safety check — if the stock has moved since I last verified it (someone else did something in between), the `UPDATE` affects 0 rows instead of silently overwriting a stock level it didn't account for. **Check `ROW COUNT` after each `UPDATE` before `COMMIT` — if either is 0, `ROLLBACK` and re-derive the numbers against the then-current state instead of forcing it through.**
- `created_by_id: NULL` — there's no real user performing this correction; if your audit tooling prefers a real user id for provenance, substitute your own membership's `user.id` in `cafe-71`.
- `gen_random_uuid()::text` for the new row's `id` produces a valid unique string primary key but won't look like the app's usual `cuid()` format — harmless (the column is just `text`, Postgres doesn't enforce cuid shape), flagging only so it doesn't look like a typo if you're scanning the table later. Confirmed `gen_random_uuid()` is built into Postgres 18 (the image this project runs), no extension needed.
- This only touches `cafe-71`'s "Test Event" data (the event the bug was diagnosed against). If the client's real "smith" event or other real catering events also show duplicate `CONSUME` rows once you check, the same pattern applies — I only reversed the two rows I found and verified; I did not go looking for other affected ingredients/events beyond what this investigation surfaced.

---

## P0-3 — backfill SQL for the 17 already-CONFIRMED invoices still stuck at $0.00

**Not run.** Root cause (see `FIX_LOG.md`, "P0-3 re-verification"): these 17 invoices were confirmed during the ~2.4-day window where the P0-3 fix was committed to git but the API hadn't actually redeployed yet (broken GitHub webhook, no manual deploy happened in that window). The fix is live now and confirmed working via a live backtest, but it only runs at `addLine`/`updateLine`/`deleteLine`/`confirm()` time — an already-`CONFIRMED` invoice's stored total is never touched again on its own, so these 17 are permanently stuck at their bad value unless corrected directly.

Each `UPDATE` recomputes `subtotal_cents` fresh from that invoice's current (non-excluded) lines and sets `total_cents = subtotal + tax`, guarded by a `WHERE total_cents = <value I last saw>` (or `IS NULL`) so it becomes a no-op instead of clobbering anything if the row has changed since I checked. Verify row counts before `COMMIT`; `ROLLBACK` if any `UPDATE` affects 0 rows unexpectedly.

**One invoice flagged, not included below — needs a human look, not a mechanical backfill:** `cmqjg1nd6005xji3ulby3cesi` (workspace `cmqjb35990006ji3uq465vfj6`, "vendor1", `INV-1001`) has `subtotalCents: 60100` stored but its lines currently sum to **$0** (likely all excluded, or lines were removed after confirm) — applying the same mechanical formula here would silently drop a $601 invoice to $1.03 (tax only). That's clearly not right; look at what actually happened to this invoice's lines before deciding what its total should be.

```sql
BEGIN;

-- Sysco Central Texas, Inc. — invoice 913814357
UPDATE invoices SET subtotal_cents = 128529, total_cents = 128529, updated_at = now()
  WHERE id = 'cmqh3lhkp0036r62key5y7d4s' AND workspace_id = 'cmq6pubr00001ek69556e1g5v' AND total_cents = 0;

-- SYSCO — invoice 84106-3287
UPDATE invoices SET subtotal_cents = 32140, total_cents = 32140, updated_at = now()
  WHERE id = 'cmqnh47c100gsji3u0pltwe5n' AND workspace_id = 'cmqh3fvth000lr62k0otop4b4' AND total_cents IS NULL;

-- vendor "?" — invoice INV-1001 (workspace cmqjb3...; note: different invoice from the flagged one above, same INV-1001 number, different workspace)
UPDATE invoices SET subtotal_cents = 3, total_cents = 3, updated_at = now()
  WHERE id = 'cmqotwaa600q6ji3u9e9c333o' AND workspace_id = 'cmqjb35990006ji3uq465vfj6' AND total_cents IS NULL;

-- vendor "?" — invoice RS-2001
UPDATE invoices SET subtotal_cents = 543000, total_cents = 543000, updated_at = now()
  WHERE id = 'cmqt20rz8011yji3udpxw6un3' AND workspace_id = 'cmqjb35990006ji3uq465vfj6' AND total_cents IS NULL;

-- vendor "?" — invoice INV-001
UPDATE invoices SET subtotal_cents = 3500, total_cents = 3500, updated_at = now()
  WHERE id = 'cmqx1kh7l0053qpmtktb66mca' AND workspace_id = 'cmqh3fvth000lr62k0otop4b4' AND total_cents IS NULL;

-- Fresh Farms Suppliers — invoice Inv-2026-001
UPDATE invoices SET subtotal_cents = 12900, total_cents = 12900, updated_at = now()
  WHERE id = 'cmqxbgckv001pe2ynjndpxns4' AND workspace_id = 'cmqxaaac70015e2ynof0x3pf4' AND total_cents IS NULL;

-- vendor "?" — invoice INV-2026-002
UPDATE invoices SET subtotal_cents = 26400, total_cents = 26400, updated_at = now()
  WHERE id = 'cmqxfg7z30050e2yn22p3xu1h' AND workspace_id = 'cmqxaaac70015e2ynof0x3pf4' AND total_cents IS NULL;

-- vendor "?" — no invoice number
UPDATE invoices SET subtotal_cents = 10000, total_cents = 10000, updated_at = now()
  WHERE id = 'cmr1rzzc9000a5pjpztstbisz' AND workspace_id = 'cmr1rzdd900015pjpo5qy8imq' AND total_cents IS NULL;

-- vendor "?" — invoice 755292997
UPDATE invoices SET subtotal_cents = 19291, total_cents = 19291, updated_at = now()
  WHERE id = 'cmrc53f8100gmfem4t1e27mcb' AND workspace_id = 'cmrc4mrvc002hfem4teu1gn04' AND total_cents = 0;

-- vendor "?" — invoice 755330115 (x4 duplicates below, different workspaces — looks like the same
-- source invoice was imported/tested into several different test workspaces)
UPDATE invoices SET subtotal_cents = 158816, total_cents = 158816, updated_at = now()
  WHERE id = 'cmroqkavk009v104y9hkpnx3e' AND workspace_id = 'cmroq785y006c104y32wn8pu4' AND total_cents = 0;
UPDATE invoices SET subtotal_cents = 158816, total_cents = 158816, updated_at = now()
  WHERE id = 'cmroqnhva00bq104y4r7bjhhc' AND workspace_id = 'cmroqmw9v00bh104y45i9scwg' AND total_cents = 0;
UPDATE invoices SET subtotal_cents = 158771, total_cents = 158771, updated_at = now()
  WHERE id = 'cmrqeedlk0001yf7wgy9t5lqx' AND workspace_id = 'cmrou917400fk104yny71u1hg' AND total_cents = 0;
UPDATE invoices SET subtotal_cents = 158816, total_cents = 158816, updated_at = now()
  WHERE id = 'cmrt5lxw200lm9uv8ov74hbvs' AND workspace_id = 'cmrt5jccr00l79uv86uqao2vv' AND total_cents = 0;

-- Sysco — invoice 935708 (cafe-71)
UPDATE invoices SET subtotal_cents = 158816, total_cents = 158816, updated_at = now()
  WHERE id = 'cmrs1n5a5008q9uv89alhvoc5' AND workspace_id = 'cmq8woxqi0007q0u7zxgfab5q' AND total_cents = 0;

-- Charlie's Produce — invoice 120624947 (cafe-71)
UPDATE invoices SET subtotal_cents = 36333, total_cents = 36333, updated_at = now()
  WHERE id = 'cmrs1riso00ft9uv8lxmp8cel' AND workspace_id = 'cmq8woxqi0007q0u7zxgfab5q' AND total_cents = 0;

-- Charlie's Produce — invoice TEST-TOFU-002 (cafe-71) -- THIS is the client's literal reported $150 tofu invoice
UPDATE invoices SET subtotal_cents = 15000, total_cents = 15000, updated_at = now()
  WHERE id = 'cmrs2132c00iq9uv8iec5bktp' AND workspace_id = 'cmq8woxqi0007q0u7zxgfab5q' AND total_cents IS NULL;

COMMIT;
```

Let me know if you want these run as-is, want the flagged `INV-1001`/`vendor1` invoice looked at first, or want to just have the client re-open and re-save each one from the UI instead (also works — editing/re-confirming isn't possible once `CONFIRMED` though, so UI-side that specific invoice's Total field would need a manual edit via the invoice detail page's PATCH, landing at the same corrected numbers).

---

## BUG 3 — Does the customer's quote total include labor, or is labor purely an internal cost? — RESOLVED

**Resolved: labor IS billed to the customer.** Fixed in all 3 code paths (see `FIX_LOG.md` for the overnight-batch entry) — `computeLiveQuoteTotalCents()`, the saved event detail page's Quote Summary (`MenuSection`), and the frontend Profit/Margin fallback calc all now include labor, matching the create-event page and the actual `sendQuote()` customer email, which already did. See the new section below for the backfill needed on already-paid events.

<details><summary>Original question (kept for history)</summary>



Three places in the code disagree, and this isn't cosmetic — it decides what counts as real revenue.

- **Create-event page** and **the actual `sendQuote()` customer email** both compute `total = menu subtotal + markup + labor`. Two independent, real, customer-facing surfaces agree labor is billed.
- **The saved event detail page's Quote Summary** computes `total = menu subtotal + markup` (no labor) — this is the exact $4,414 vs. $3,789 gap you saw, and it's the reported bug.
- **`computeLiveQuoteTotalCents()`** — the shared backend function that freezes `Event.quotedPriceCents` at `markAsPaid()` time (i.e. what actually becomes "revenue" for the Dashboard and every report) — has its own explicit code comment saying labor is deliberately excluded, "a separate cost line subtracted in the profit calc, not part of revenue."

So `sendQuote()` and `computeLiveQuoteTotalCents()` — one downstream of the other in spirit, both meant to represent "the quote total" — actively disagree with each other today.

**The real-money question:** does your business bill the client for labor as part of the catering total (a staffing/service fee the client pays), or is labor purely what it costs *you* to staff the event, never itemized to the client? I don't know your actual billing practice and won't guess at it, because whichever way this goes:

- If labor **should** be revenue: `computeLiveQuoteTotalCents()` needs `+ labor`, and every already-PAID event with a labor cost has been under-counting revenue in the Dashboard/Reports (P0-4 work) until this is fixed — likely needs its own small backfill pass, similar in spirit to the P0-3 invoice backfill, once decided.
- If labor should **NOT** be revenue: the create-event page and `sendQuote()`'s customer email are the ones that need fixing (strip labor out), and any already-sent quote/invoice that included labor may have overbilled a real client — a conversation with affected clients might be needed, not just a code fix.

Either direction is a quick, mechanical code change once you tell me which one is correct — I just don't want to guess at something that changes what a customer is billed or how revenue is reported.

</details>

---

## BUG 3 — backfill SQL for the 1 already-PAID event undercounted by the labor bug

**Not run.** Now that labor is correctly included in `computeLiveQuoteTotalCents()` (see `FIX_LOG.md`), any event paid *before* this fix has a `quotedPriceCents` frozen without its labor amount. Swept all `PAID` events workspace-wide for `laborTotalCents > 0` with a frozen `quotedPriceCents`: **only one** is affected.

| Event | Workspace | Current `quotedPriceCents` | `laborTotalCents` | Corrected |
|---|---|---|---|---|
| `cmruvq0p9000i9tkt1x1gpy5v` ("zdvs") | `cmrt5jccr00l79uv86uqao2vv` | $3,789.00 | $250.00 | **$4,039.00** |

Total revenue undercounted across all of production: **$250.00**, on this one event.

**Not in scope of this backfill, flagging separately:** the frontend's Profit/Margin calc actually prefers `EventStaffAssignment`-derived labor (`staffLaborCents`) over the simple `laborTotalCents` estimate when staff assignments exist (`staffLaborCents || event.laborTotalCents`). `computeLiveQuoteTotalCents()` — and this backfill — only ever look at `laborTotalCents`, matching the create-page/`sendQuote()` formula exactly as those two already worked. If you also want staff-assignment-based labor billed as part of the customer's quote total (a different, bigger question — should the customer's bill reflect actual assigned staff-hours rather than the simple estimate?), that's a separate decision, not guessed at here.

```sql
-- zdvs (cmruvq0p9000i9tkt1x1gpy5v) -- guarded by current quotedPriceCents so
-- this is a no-op if anything has changed since this was checked.
UPDATE events SET quoted_price_cents = 403900, updated_at = now()
  WHERE id = 'cmruvq0p9000i9tkt1x1gpy5v' AND workspace_id = 'cmrt5jccr00l79uv86uqao2vv' AND quoted_price_cents = 378900;
```

Run this the same way as the P0-3 invoice backfill (single connection, check "1 row affected", `ROLLBACK`/investigate if it shows 0 — means the event changed since I checked). After running, the Dashboard/Reports for that event's workspace will show $250 more revenue and correspondingly different margin for that one event.

---

## BUG 5 — Public quote page doesn't exist; needs to be built (scope, not started)

"Send Quote" → "Email not set up" happens because `RESEND_API_KEY` isn't set in this environment (an API-side/Railway secret, not something Vercel needs). Separately, and worse: the "Copy quote & link" fallback copies `window.location.href` — literally the current page's own internal, login-walled URL (`workspace.ibirdos.com/{workspace}/events/{id}`). A client pasted this link hits your login page for a workspace they have no account in. Confirmed via a full `@Public()` route grep across the API: **no public quote-viewing page or route exists anywhere today** — the only similarly-named endpoint (`/orders/quote`) is an unrelated customer-ordering feature.

This needs building, not fixing — real scope, roughly in order of what touches what:

1. **A way to identify one event without login.** Simplest: an unguessable token. Additive schema change (e.g. `Event.quoteToken String? @unique`, generated the first time a quote is sent/copied) — written to `PENDING_MIGRATIONS.sql` if you want to proceed, not run by me.
2. **A new public API route** (`@Public()`, rate-limited like the other public routes) resolving `token → event`, returning only what an external client should see (menu, total, business name/venue — no other tenant data, no mutation capability).
3. **A new public web page** (outside the `[workspace]` layout entirely, e.g. `/quote/[token]`) rendering that data for an external client to actually open.
4. **Update `sendQuote()`'s email and the copy-link fallback** to point at this new page instead of the internal one.
5. Decide: should the link expire? Should it go dead once the event is paid/completed/cancelled? Should re-sending a quote reuse the same token or mint a new one (invalidating the old link)?

This is a real, multi-file, security-relevant feature (public unauthenticated data exposure, even if scoped/redacted) — not something I'll build without your go-ahead on scope and the token/expiry model. Let me know if you want this built, and if so, answers to the expiry/reuse questions in point 5 so I don't guess at the security model.

---

## P1-B — Ingredient categories default to OTHER: detection exists, but was never wired to a real category, and mapping it needs a decision

**Not a simple bug — investigated fully, here's the exact shape of it.**

The **only** place that assigns `category` at ingredient creation is `InvoicesService.confirm()`'s auto-create-unmatched-ingredient path (`apps/api/src/invoices/invoices.service.ts:396`), which hardcodes `category: "OTHER"` unconditionally. The manual "New ingredient" page already lets a human pick a real category — this only affects ingredients auto-created from an invoice line the system couldn't match to an existing ingredient.

**The AI extraction already detects a category — it's just never used.** `packages/ai/src/invoice-extraction.ts`'s prompts explicitly ask the model to capture the food-section header above each line item (its own words: *"category — the section header above this item, propagated until the next header (e.g. 'Grocery/Storeroom', 'Dairy/Milk', 'Meat/Poultry', 'Cleaning Supplies', 'MEATS', 'PRODUCE', 'FROZEN', 'MISC CHARGES')"*), and the response schema has a `category: z.string().nullish()` field for exactly this. But it's currently used **only** internally by the extraction worker to reconcile extracted line sums against the invoice's own printed GROUP TOTAL rows (a QA check) — it is **never persisted**. `InvoiceLine` has no column to store it, and it's discarded before `confirm()` ever runs.

**Why this needs a decision, not a guess:** wiring this up means building a genuinely new mapping layer, not just "use the field that's already there" — because the AI's extracted text is raw vendor-invoice wording (`"MEATS"`, `"Meat/Poultry"`, `"POULTRY"`, `"Dairy/Milk"`, `"CANNED & DRY"`, `"Grocery/Storeroom"`, `"MISC CHARGES"`, `"Cleaning Supplies"`, etc. — different vendors, different wording, not standardized) and the app's `IngredientCategory` enum is a fixed 11 values (`PRODUCE, PROTEIN, DAIRY, DRY_GOODS, SPICES, OIL_VINEGAR, BEVERAGE, FROZEN, BAKERY, PACKAGING, CLEANING, OTHER`). Someone has to decide the mapping rules, including the genuinely ambiguous ones (does `"MISC CHARGES"` map to `OTHER`, or should misc-charge lines even become ingredients at all? Does `"Grocery/Storeroom"` mean `DRY_GOODS`? Does an unrecognized/unmapped header default to `OTHER` — same as today — or get flagged `needsReview` instead of silently guessing?).

**What building this would take, if you want it:**
1. Additive schema: a column to actually persist the AI's raw category text on `InvoiceLine` (e.g. `rawCategoryHint String?`) — would go in `PENDING_MIGRATIONS.sql`, not run, per your migration rule.
2. Thread that value through from the extraction worker (currently computed, currently thrown away) into the persisted `InvoiceLine` row.
3. A keyword/mapping table (raw vendor text → `IngredientCategory` enum) used at `confirm()`'s auto-create-ingredient step instead of the hardcoded `"OTHER"`.
4. A decision on the fallback: keep defaulting genuinely-unmatched headers to `OTHER` (safe, matches today's behavior for the unmappable cases), or something else (e.g. surface a "needs category" review flag instead of silently picking one).

I can build a first-pass mapping table from the vendor header examples already visible in the AI prompts as a starting point, but I don't want to invent the full rule set and ship it unattended — a wrong category assignment is a data-quality issue that's mildly annoying to fix per-ingredient later, but I'd rather you weigh in on the ambiguous cases (especially `MISC CHARGES`) before I build it. Let me know if you want this built and how you want the unmapped/ambiguous cases handled.

---
