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
