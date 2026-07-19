# Needs Roshan — decisions / risks / things I will not guess on

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
