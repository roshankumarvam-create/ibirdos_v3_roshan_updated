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
   * Packaging/delivery/other per-event costs. No such figure is
   * currently tracked anywhere in the event-cost pipeline (Recipe has
   * a paperCostCents field, but it isn't rolled into any event or
   * recipe cost total today) -- defaults to 0 so this formula is a
   * straight revenue-food-labor calc until that's wired up. Accepting
   * the parameter now means the day it IS wired up, every caller of
   * this function picks it up for free instead of needing a second
   * round of "who forgot to subtract it" fixes.
   */
  otherCostCents?: number;
}

export interface EventProfitResult {
  profitCents: number | null;
  marginPct: number | null;
}

export function computeEventProfit(inputs: EventProfitInputs): EventProfitResult {
  const { revenueCents, foodCostCents, laborCostCents, otherCostCents = 0 } = inputs;
  if (revenueCents == null || revenueCents <= 0) {
    return { profitCents: null, marginPct: null };
  }
  const profitCents = revenueCents - foodCostCents - laborCostCents - otherCostCents;
  const marginPct = (profitCents / revenueCents) * 100;
  return { profitCents, marginPct };
}
