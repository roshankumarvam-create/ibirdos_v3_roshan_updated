// =====================================================================
// packages/types/src/money.ts
// =====================================================================
// THE event profit formula. Single source of truth for both the "live"
// estimate (create-event page, saved-but-unpaid event page) and the
// "frozen" P&L (rollupCosts()'s persisted computedMarginPct, the
// analytics dashboard, the /analytics/pnl report). Before this existed,
// the same subtraction was written out separately in four places and
// one of them (the create-event page's "Est. profit" widget) never got
// updated when labor was added to revenue -- it kept computing
// revenue - food with no labor subtracted back out, overstating profit
// by exactly the labor amount. See FIX_LOG.md.
//
// revenueCents is expected to already include any billed labor charge
// (Roshan's decision: labor IS billed to the customer, part of revenue
// -- see computeLiveQuoteTotalCents in events.service.ts). laborCostCents
// here is subtracted as a COST on top of that, which is not double
// counting: it nets to zero profit impact when you charge the client
// exactly what the labor costs you, and only shows up as real profit/
// loss when the billed labor and the actual labor cost differ.
// =====================================================================

export interface EventProfitInputs {
  revenueCents: number | null | undefined;
  foodCostCents: number;
  laborCostCents: number;
  /**
   * #2: per-event direct cost inputs (packaging/delivery/equipment
   * rental, plus a catch-all "other"). Wired up via the additive
   * Event.{packaging,delivery,equipment,other_direct}_cost_cents
   * columns -- see event-direct-costs.raw.ts and PENDING_MIGRATIONS.sql.
   * All default to 0, so any caller that predates this (or a workspace
   * where the migration hasn't run yet) gets the exact same
   * revenue-food-labor result as before -- this is a pure addition, not
   * a behavior change for existing callers.
   */
  packagingCostCents?: number;
  deliveryCostCents?: number;
  equipmentCostCents?: number;
  /** Catch-all for direct costs that don't fit the three categories above. */
  otherCostCents?: number;
}

export interface EventProfitResult {
  profitCents: number | null;
  marginPct: number | null;
}

export function computeEventProfit(inputs: EventProfitInputs): EventProfitResult {
  const {
    revenueCents, foodCostCents, laborCostCents,
    packagingCostCents = 0, deliveryCostCents = 0, equipmentCostCents = 0, otherCostCents = 0,
  } = inputs;
  if (revenueCents == null || revenueCents <= 0) {
    return { profitCents: null, marginPct: null };
  }
  const directCostsCents = packagingCostCents + deliveryCostCents + equipmentCostCents + otherCostCents;
  const profitCents = revenueCents - foodCostCents - laborCostCents - directCostsCents;
  const marginPct = (profitCents / revenueCents) * 100;
  return { profitCents, marginPct };
}

// ---------------------------------------------------------------------
// Client-reported issue #2: "opened a high-food-cost event, saw NO
// below-target-margin warning." Investigated first -- no such warning
// (banner, text, alert) exists anywhere in the codebase or FIX_LOG.md
// history under any name; #2 was never part of either the original P0
// batch (#1/#3/#4) or the Phase 2 priority list (started at #9/#11) --
// genuinely never built, not a deploy gap. The only existing signal was
// silent color-tinting on the saved event page's Margin %/Profit KpiCard
// (events/[id]/page.tsx: `marginPct < 25 ? "danger" : marginPct < 45 ?
// "warning" : "default"`) -- present only on the SAVED page, absent
// entirely from the create-quote page, and a color change alone doesn't
// read as a warning (easy to miss, no text, no accessibility fallback).
//
// No event-level or workspace-level "target margin" exists anywhere to
// read a real threshold from (only Recipe.goalFoodCostPct/targetMarginPct,
// per-recipe, already flagged in NEEDS_ROSHAN.md as unreconciled -- not
// reused here to avoid introducing a fourth conflicting "target"
// concept). These two numbers make the ALREADY-HARDCODED KPI-tone
// thresholds explicit and named, instead of inventing a new business
// number: 45% margin was already the "warning" cutoff, 25% the
// "danger"/critical cutoff, both silently baked into the tone logic above.
// ---------------------------------------------------------------------

export const MARGIN_WARNING_THRESHOLD_PCT = 45;
export const MARGIN_CRITICAL_THRESHOLD_PCT = 25;

export type MarginWarningLevel = "none" | "warning" | "critical";

export function getMarginWarningLevel(marginPct: number | null | undefined): MarginWarningLevel {
  if (marginPct == null) return "none";
  if (marginPct < MARGIN_CRITICAL_THRESHOLD_PCT) return "critical";
  if (marginPct < MARGIN_WARNING_THRESHOLD_PCT) return "warning";
  return "none";
}
