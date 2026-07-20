# Needs Roshan — decisions / risks / things I will not guess on

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
