// =====================================================================
// apps/api/src/events/event-ingredient-shortage.service.ts
// =====================================================================
// Outstanding post-consumption shortage ledger. See PENDING_MIGRATIONS.sql
// for the (not-yet-run) event_ingredient_shortages table and the full
// rationale. Same inert-until-migrated pattern as quote-token.service.ts
// originally used: every method here goes through raw SQL only and treats
// "relation ... does not exist" (Postgres 42P01, table not migrated yet)
// as "feature not enabled" -- log a warning, no-op, never throw. Until the
// migration runs, KitchenService.consumeIngredients() calling recordShortage()
// is a safe no-op and the event page's outstanding-shortage banner simply
// never has anything to show.
//
// Deliberately separate from Event.inventoryShortages (the existing,
// untouched, write-once-at-markAsPaid() pre-emptive check that still
// drives the "Acknowledge -- proceed anyway" soft gate). This ledger only
// ever gets rows from REAL, already-happened shortfalls recorded by
// consumeIngredients() -- never a live recompute against current stock,
// which is exactly the trap that made the original bug's numbers
// misleading (see FIX_LOG.md).
// =====================================================================

import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("EventIngredientShortageService");

export interface RecordShortageParams {
  eventId: string;
  ingredientId: string;
  ingredientName: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  neededCanonical: number;
  consumedCanonical: number;
  shortCanonical: number;
  estCostCents: number | null;
  sourceTaskId: string | null;
}

export interface OutstandingShortage {
  id: string;
  ingredientId: string;
  ingredientName: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  neededCanonical: number;
  consumedCanonical: number;
  shortCanonical: number;
  estCostCents: number | null;
  createdAt: Date;
  // Live current stock, joined at read time -- used ONLY to show a
  // non-mutating "stock now sufficient" badge. Never written back into
  // shortCanonical; the recorded shortfall stays a frozen fact until a
  // human resolves it. See v1 scope note in NEEDS_ROSHAN.md re: no
  // auto-resolve-on-receive.
  currentStockCanonical: number;
}

function isMissingTable(err: any): boolean {
  return typeof err?.message === "string" && /relation .* does not exist/i.test(err.message);
}

export async function recordShortage(ctx: TenantContext, params: RecordShortageParams): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO event_ingredient_shortages (
        workspace_id, event_id, ingredient_id, ingredient_name, canonical_unit,
        preferred_display_unit, needed_canonical, consumed_canonical, short_canonical,
        est_cost_cents, source_task_id
      ) VALUES (
        ${ctx.workspaceId}, ${params.eventId}, ${params.ingredientId}, ${params.ingredientName}, ${params.canonicalUnit},
        ${params.preferredDisplayUnit}, ${params.neededCanonical}, ${params.consumedCanonical}, ${params.shortCanonical},
        ${params.estCostCents}, ${params.sourceTaskId}
      )
    `;
  } catch (err: any) {
    if (!isMissingTable(err)) throw err;
    log.warn(
      { eventId: params.eventId, ingredientId: params.ingredientId, err: err.message },
      "event_ingredient_shortages table not migrated yet -- skipping (feature inert until PENDING_MIGRATIONS.sql is run)",
    );
  }
}

export async function listOutstandingForEvent(ctx: TenantContext, eventId: string): Promise<OutstandingShortage[]> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string; ingredient_id: string; ingredient_name: string; canonical_unit: string;
      preferred_display_unit: string | null; needed_canonical: any; consumed_canonical: any;
      short_canonical: any; est_cost_cents: number | null; created_at: Date;
      current_stock_canonical: any;
    }>>`
      SELECT s.id, s.ingredient_id, s.ingredient_name, s.canonical_unit, s.preferred_display_unit,
             s.needed_canonical, s.consumed_canonical, s.short_canonical, s.est_cost_cents, s.created_at,
             i.current_stock_canonical
      FROM event_ingredient_shortages s
      LEFT JOIN ingredients i ON i.id = s.ingredient_id
      WHERE s.workspace_id = ${ctx.workspaceId} AND s.event_id = ${eventId} AND s.resolved_at IS NULL
      ORDER BY s.created_at ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      canonicalUnit: r.canonical_unit,
      preferredDisplayUnit: r.preferred_display_unit,
      neededCanonical: Number(r.needed_canonical),
      consumedCanonical: Number(r.consumed_canonical),
      shortCanonical: Number(r.short_canonical),
      estCostCents: r.est_cost_cents,
      createdAt: r.created_at,
      currentStockCanonical: r.current_stock_canonical != null ? Number(r.current_stock_canonical) : 0,
    }));
  } catch (err: any) {
    if (!isMissingTable(err)) throw err;
    return [];
  }
}

/** Returns true if a row was actually resolved (existed, unresolved, in this workspace). */
export async function resolveShortage(ctx: TenantContext, id: string, resolvedById: string): Promise<boolean> {
  try {
    const affected: number = await prisma.$executeRaw`
      UPDATE event_ingredient_shortages
      SET resolved_at = now(), resolved_by_id = ${resolvedById}
      WHERE id = ${id} AND workspace_id = ${ctx.workspaceId} AND resolved_at IS NULL
    `;
    return affected > 0;
  } catch (err: any) {
    if (!isMissingTable(err)) throw err;
    return false;
  }
}
