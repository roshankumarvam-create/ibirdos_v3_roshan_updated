import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { canViewFinancials } from "@ibirdos/permissions";
import { computeEventProfit, getMarginWarningLevel, MARGIN_WARNING_THRESHOLD_PCT, MARGIN_CRITICAL_THRESHOLD_PCT } from "@ibirdos/types";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Badge, Button, EmptyState } from "@ibirdos/ui";
import { StatusBadge } from "@/components/common/status-badge";
import { formatCents, formatPct, formatDateTime, formatDate } from "@/lib/format";
import { MenuSection } from "./menu-section";
import { ShortageBanner } from "./shortage-banner";
import { OutstandingShortageBanner } from "./outstanding-shortage-banner";
import { MarkPaidButton } from "./mark-paid-button";
import { SendQuoteButton } from "./send-quote-button";
import { DeleteEventButton } from "./delete-event-button";
import { DirectCostsCard } from "./DirectCostsCard";

interface MenuItem {
  id: string;
  recipeId: string;
  portions: number;
  displayOrder: number;
  recipe: {
    id: string;
    name: string;
    portionsYielded: number | null;
    prepTimeMin: number | null;
    cookTimeMin: number | null;
    // Omitted from the API response entirely (not sent as null) for roles
    // without financial visibility -- see redactEventFinancials().
    cachedCostMicrocents?: string | null;
    salePriceCents?: number | null;
  };
  unitPriceCentsAtAdd?: number | null;
  unitPriceCentsOverride?: number | null;
}

interface KitchenTask {
  id: string;
  title: string;
  recipeId: string | null;
  targetPortions: number | null;
  taskType: string;
  status: string;
}

interface Shortage {
  ingredientId: string;
  name: string;
  neededCanonical: number;
  haveCanonical: number;
  shortCanonical: number;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  // Omitted from the API response entirely (not sent as null) for roles
  // without financial visibility -- see redactEventFinancials().
  vendorId?: string | null;
  lastUnitPriceCents?: number | null;
  estCostCents?: number | null;
}

interface OutstandingShortage {
  id: string;
  ingredientId: string;
  ingredientName: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  neededCanonical: number;
  consumedCanonical: number;
  shortCanonical: number;
  currentStockCanonical: number;
  createdAt: string;
  // Omitted from the API response entirely (not sent as null) for roles
  // without financial visibility -- see EventsService.getOutstandingShortages().
  estCostCents?: number | null;
}

interface EventDetail {
  id: string;
  name: string;
  status: string;
  serviceType: string;
  customerName: string | null;
  customerContact: string | null;
  venueAddress: string | null;
  startsAt: string;
  endsAt: string | null;
  prepStartsAt: string | null;
  guestCount: number;
  portionMultiplier: number;
  notes: string | null;
  frozenAt: string | null;
  paymentStatus: string;
  // inventoryCheckedAt is still used below (displayed as "when did this
  // happen" on the Kitchen tasks generated card). inventoryShortages is
  // NOT -- it's a write-only, deprecated-for-display audit snapshot from
  // markAsPaid(); the `shortages` array actually rendered on this page is
  // derived from the live `requirements` fetch instead, see below. Do not
  // read this field again expecting a live value -- see the
  // Event.inventoryShortages doc comment in schema.prisma.
  inventoryCheckedAt: string | null;
  inventoryShortages: Shortage[] | null;
  shortageAcknowledged: boolean;
  menuItems: MenuItem[];
  staff: Array<{
    id: string;
    role: string;
    hours: number;
    user: { id: string; username: string; displayName: string | null } | null;
    // Omitted from the API response entirely (not sent as null) for roles
    // without financial visibility -- see redactEventFinancials().
    hourlyRateCents?: number;
  }>;
  kitchenPacket: { id: string; generatedAt: string } | null;
  kitchenTasks: KitchenTask[];
  // Financial fields below are all omitted from the API response entirely
  // (not sent as null) for roles without financial visibility -- see
  // canViewFinancials()/redactEventFinancials() in events.service.ts.
  quotedPriceCents?: number | null;
  computedFoodCostCents?: number | null;
  computedLaborCostCents?: number | null;
  computedMarginPct?: number | null;
  laborTotalCents?: number;
  frozenRecipeCostsCents?: Record<string, number> | null;
  frozenIngredientPricesCents?: Record<string, number> | null;
  markupPct?: number;
  quotedTotalOverrideCents?: number | null;
  // #2: additive, inert-until-migrated (see event-direct-costs.raw.ts) --
  // omitted from the API response entirely for roles without financial
  // visibility, same as the other cost fields above. Present as 0 (not
  // undefined) once a role CAN see financials, even before the migration
  // runs -- the raw-SQL layer degrades to 0, not to "field missing".
  packagingCostCents?: number;
  deliveryCostCents?: number;
  equipmentCostCents?: number;
  otherDirectCostCents?: number;
}

interface IngredientRequirement {
  ingredientId: string;
  ingredientName: string;
  canonicalUnit: string;
  displayUnit: string;
  requiredCanonical: number;
  requiredDisplay: number;
  currentStockCanonical: number;
  currentStockDisplay: number;
  gap: number;
  gapDisplay: number;
  isShort: boolean;
  // Omitted from the API response entirely (not sent as null) for roles
  // without financial visibility -- see canViewFinancials() in
  // events.service.ts's ingredientRequirements().
  lastUnitPriceCents: number | null;
  vendorId?: string | null;
  estCostCents?: number | null;
}

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", CONFIRMED: "info", PREP_IN_PROGRESS: "warning",
  IN_SERVICE: "success", COMPLETED: "neutral", CANCELLED: "danger",
};

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = await params;
  const user = await requireSession();
  const c = await cookies();
  const canSeeFinancials = canViewFinancials(user.role);

  const [eventRes, reqRes, outstandingRes] = await Promise.all([
    api.get<EventDetail>(`/events/${id}`, { cookies: c }),
    api.get<IngredientRequirement[]>(`/events/${id}/ingredient-requirements`, { cookies: c }),
    api.get<OutstandingShortage[]>(`/events/${id}/outstanding-shortages`, { cookies: c }),
  ]);

  if (!eventRes.data) notFound();
  const event = eventRes.data;
  const requirements = reqRes.data ?? [];
  const outstandingShortages = outstandingRes.data ?? [];

  const isPaid = event.paymentStatus === "PAID";
  // P0-3 fix: previously read event.inventoryShortages, a snapshot frozen
  // once at markAsPaid() time and never refreshed -- it could disagree
  // with the ingredient-requirements table below (which is always live)
  // any time stock moved after payment. Both now derive from the exact
  // same `requirements` fetch, so they can't disagree again.
  const shortages: Shortage[] = requirements
    .filter((r) => r.isShort)
    .map((r) => ({
      ingredientId: r.ingredientId,
      name: r.ingredientName,
      neededCanonical: r.requiredCanonical,
      haveCanonical: r.currentStockCanonical,
      shortCanonical: r.gap,
      canonicalUnit: r.canonicalUnit,
      preferredDisplayUnit: r.displayUnit,
      vendorId: r.vendorId ?? null,
      lastUnitPriceCents: r.lastUnitPriceCents,
      estCostCents: r.estCostCents ?? null,
    }));
  const shortagesActive = shortages.length > 0 && !event.shortageAcknowledged;
  // Staff-assignment labor when assignments exist; fall back to the simple estimate field
  // (laborTotalCents is set at event creation via laborHoursEstimate × laborRateCentsPerHour,
  //  and is what sendQuote uses for the customer-facing total — margin must match)
  const staffLaborCents = event.staff.reduce(
    (sum, s) => sum + Math.round(Number(s.hours) * (s.hourlyRateCents ?? 0)),
    0,
  );
  const totalLaborCents = staffLaborCents || (event.laborTotalCents ?? 0);
  const shortItems = requirements.filter((r) => r.isShort);

  // Live food cost from menu items (used when computedFoodCostCents is not yet set)
  const liveFoodCostCents = event.menuItems.reduce((sum, mi) => {
    const costMicrocents = mi.recipe.cachedCostMicrocents ? Number(mi.recipe.cachedCostMicrocents) : 0;
    const portionsYielded = mi.recipe.portionsYielded ?? 1;
    return sum + Math.round((costMicrocents / 1000) / portionsYielded * mi.portions);
  }, 0);
  const foodCostCents = event.computedFoodCostCents ?? liveFoodCostCents;

  // Effective revenue: prefer the menu-builder override, then static/frozen quoted
  // price. Kept strict (persisted values only) -- the Revenue KPI stays "—"/"No quote
  // yet" until an actual quote is saved or the event is paid (markAsPaid freezes it).
  const effectiveQuoteCents = event.quotedTotalOverrideCents ?? event.quotedPriceCents;
  const revenueCents = effectiveQuoteCents ?? null;

  // Live computed quote total (menu subtotal + markup% + labor) -- same
  // formula as MenuSection's "Total quote" display and the backend's
  // computeLiveQuoteTotalCents(). BUG 3 fix: this previously excluded
  // labor, which was the exact reported inconsistency ($4,414 at creation
  // vs. $3,789 saved) -- labor IS billed to the customer (Roshan's
  // decision), so it belongs in the total everywhere it's computed.
  // Profit/Margin use this as a further fallback beyond revenueCents: they should
  // populate as soon as ANY quote total exists, even one that's only been computed
  // live and never explicitly saved -- unlike Revenue, which stays persisted-only.
  const quoteSubtotalCents = event.menuItems.reduce((sum, mi) => {
    const unitPrice = mi.unitPriceCentsOverride ?? mi.unitPriceCentsAtAdd ?? mi.recipe.salePriceCents ?? 0;
    return sum + unitPrice * mi.portions;
  }, 0);
  const liveQuoteTotalCents = quoteSubtotalCents + Math.round(quoteSubtotalCents * (Number(event.markupPct ?? 0) / 100)) + totalLaborCents;

  // P0-1: shared formula with the create-event page and the backend P&L --
  // see packages/types/src/money.ts. This page already subtracted labor
  // correctly; unifying onto one helper means it can't quietly drift from
  // the other two call sites again the way the create-event page did.
  const profitBaseCents = revenueCents ?? (liveQuoteTotalCents > 0 ? liveQuoteTotalCents : null);
  // #2: packaging/delivery/equipment/other -- 0 (not undefined) once this
  // role can see financials at all, even before the migration runs (the
  // raw-SQL layer already degrades to 0 server-side).
  const { profitCents, marginPct } = computeEventProfit({
    revenueCents: profitBaseCents, foodCostCents: foodCostCents, laborCostCents: totalLaborCents,
    packagingCostCents: event.packagingCostCents ?? 0,
    deliveryCostCents: event.deliveryCostCents ?? 0,
    equipmentCostCents: event.equipmentCostCents ?? 0,
    otherCostCents: event.otherDirectCostCents ?? 0,
  });
  const marginWarningLevel = getMarginWarningLevel(marginPct);
  // #2: food margin only (revenue vs food cost) -- deliberately NOT run
  // through computeEventProfit(), which also subtracts labor + direct
  // costs for the final profit figure. Same revenueCents/foodCostCents
  // already in scope above; no new data needed.
  const foodMarginPct = profitBaseCents && profitBaseCents > 0
    ? ((profitBaseCents - foodCostCents) / profitBaseCents) * 100
    : null;

  const prepTasks = (event.kitchenTasks ?? []).filter((t) => t.taskType === "PREP");
  const serviceTasks = (event.kitchenTasks ?? []).filter((t) => t.taskType === "SERVICE");

  const aiSummary = requirements.length > 0
    ? requirements
        .slice(0, 5)
        .map((r) => {
          const status = r.isShort ? `SHORT ${r.gapDisplay.toFixed(1)} ${r.displayUnit}` : "OK";
          return `${r.ingredientName}: need ${r.requiredDisplay.toFixed(1)} ${r.displayUnit}, have ${r.currentStockDisplay.toFixed(1)} — ${status}`;
        })
        .join(" · ")
    : null;

  return (
    <div className="space-y-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/${workspace}/events` as any} className="text-xs text-text-tertiary hover:text-accent-500">← Events</Link>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{event.name}</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {formatDateTime(event.startsAt, user.workspaceTimeZone)}
            {event.venueAddress && ` · ${event.venueAddress}`}
            {event.customerName && ` · ${event.customerName}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge label={event.status.toLowerCase().replace(/_/g, " ")} tone={STATUS_TONE[event.status] ?? "neutral"} />
          {isPaid && (
            <StatusBadge label="Paid" tone="success" />
          )}
          {event.frozenAt ? (
            <span
              className="inline-flex items-center gap-1 rounded border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 text-[10px] font-medium text-accent-400"
              title={`Costs locked on ${formatDate(event.frozenAt, user.workspaceTimeZone)} · event date ${formatDate(event.startsAt, user.workspaceTimeZone)}`}
            >
              Frozen quote · locked {formatDate(event.frozenAt, user.workspaceTimeZone)} · event {formatDate(event.startsAt, user.workspaceTimeZone)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              Live quote
            </span>
          )}
          {(event.status === "DRAFT" || event.status === "CONFIRMED") && !isPaid && (
            <SendQuoteButton
              eventId={event.id}
              clientEmail={event.customerContact}
              eventName={event.name}
            />
          )}
          {!isPaid && <MarkPaidButton eventId={event.id} />}
          {(user.role === "OWNER" || user.role === "MANAGER") && (
            <DeleteEventButton eventId={event.id} workspaceSlug={workspace} eventName={event.name} />
          )}
        </div>
      </div>

      {/* Shortage banner — shown when PAID and shortages exist. Live as of
          this page load (derived from the same `requirements` fetch as the
          ingredient-requirements table below, see the `shortages` derivation
          above) -- drives the "Acknowledge, proceed anyway" soft gate. P0-3
          fix: this used to read Event.inventoryShortages, a snapshot frozen
          once at markAsPaid() time, which could disagree with the table.
          Not touched by the outstanding-shortage work below. */}
      {isPaid && shortages.length > 0 && (
        <ShortageBanner
          eventId={event.id}
          shortages={shortages}
          alreadyAcknowledged={event.shortageAcknowledged}
          canSeeFinancials={canSeeFinancials}
        />
      )}

      {/* Outstanding shortage banner — real, already-happened shortfalls
          from kitchen consumption (KitchenService.consumeIngredients()),
          separate from the pre-emptive banner above. Visible regardless of
          acknowledgement/payment status; stays until resolved. */}
      {outstandingShortages.length > 0 && (
        <OutstandingShortageBanner
          eventId={event.id}
          shortages={outstandingShortages}
          canSeeFinancials={canSeeFinancials}
        />
      )}

      {/* Issue #2 fix: explicit, clearly-labeled warning instead of the
          Margin % KPI card's color tint alone -- the tint was easy to miss
          (no text, easy to skim past) and didn't exist at all on the
          create-quote page (see events/new/page.tsx). marginWarningLevel
          uses the same 45%/25% thresholds the KPI tone below already
          quietly encoded -- see getMarginWarningLevel()'s comment in
          packages/types/src/money.ts for why those numbers, not new ones. */}
      {canSeeFinancials && marginWarningLevel !== "none" && (
        <div className={`rounded-md border px-5 py-4 ${marginWarningLevel === "critical" ? "border-danger/40 bg-danger/5" : "border-warning/40 bg-warning/5"}`}>
          <div className={`text-sm font-semibold ${marginWarningLevel === "critical" ? "text-danger" : "text-warning"}`}>
            {marginWarningLevel === "critical" ? "Margin critically low" : "Below target margin"} — {formatPct(marginPct!)}
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            This quote's margin is below {marginWarningLevel === "critical" ? `${MARGIN_CRITICAL_THRESHOLD_PCT}%` : `${MARGIN_WARNING_THRESHOLD_PCT}%`}
            {" "}after food and labor cost. Consider adjusting the markup, menu, or labor estimate before sending.
          </p>
        </div>
      )}

      {/* KPI row -- Revenue/Food cost/Labor cost/Profit/Margin are omitted
          entirely (not dashed out) for roles without financial visibility.
          #2: once frozen, every cost/profit/margin figure here reflects the
          LOCKED-IN inputs (frozenRecipeCostsCents/frozenIngredientPricesCents),
          not live ingredient prices -- "(frozen)" is now on every dependent
          KPI, not just Food cost, so the snapshot is unambiguous everywhere
          it appears, not just on the one label that happened to say so before. */}
      <div className={canSeeFinancials ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4" : "grid grid-cols-2 gap-4"}>
        <KpiCard label="Guests" value={event.guestCount.toString()} />
        {canSeeFinancials && (
          <>
            <KpiCard
              label="Revenue"
              value={revenueCents != null ? formatCents(revenueCents) : "—"}
              {...(revenueCents == null ? { sub: "No quote yet" } : {})}
            />
            <KpiCard
              label={event.frozenAt ? "Food cost (frozen)" : "Food cost"}
              value={formatCents(foodCostCents)}
              {...(revenueCents && foodCostCents
                ? { sub: `${formatPct((foodCostCents / revenueCents) * 100)} of revenue` }
                : {})}
            />
            <KpiCard
              label={event.frozenAt ? "Labor cost (frozen)" : "Labor cost"}
              value={formatCents(totalLaborCents)}
              {...(revenueCents && totalLaborCents > 0
                ? { sub: `${formatPct((totalLaborCents / revenueCents) * 100)} of revenue` }
                : {})}
            />
            {/* #2: Food margin -- revenue vs food cost ONLY, no labor/direct
                costs subtracted -- shown as its own labeled number,
                separate from Final profit margin below. Previously only
                the inverse framing (Food cost as % of revenue, above)
                existed; the two are the same underlying comparison but
                "margin" reads as "what's left", not "what was spent". */}
            <KpiCard
              label={event.frozenAt ? "Food margin (frozen)" : "Food margin"}
              value={foodMarginPct != null ? formatPct(foodMarginPct) : "—"}
            />
            <KpiCard
              label={event.frozenAt ? "Profit (frozen)" : "Profit"}
              value={profitCents != null ? formatCents(profitCents) : "—"}
              tone={profitCents != null && profitBaseCents != null
                ? (profitCents < 0 ? "danger" : profitCents < profitBaseCents * 0.2 ? "warning" : "default")
                : "default"}
              {...(profitCents == null ? { sub: "Set quote first" } : {})}
            />
            <KpiCard
              label={event.frozenAt ? "Final profit margin (frozen)" : "Final profit margin"}
              value={marginPct != null ? formatPct(marginPct) : "—"}
              tone={marginPct != null
                ? marginPct < 25 ? "danger" : marginPct < 45 ? "warning" : "default"
                : "default"}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: menu + kitchen tasks + ingredient requirements */}
        <div className="lg:col-span-2 space-y-6">
          {/* Menu with interactive quote */}
          <MenuSection
            workspace={workspace}
            eventId={event.id}
            menuItems={event.menuItems}
            guestCount={event.guestCount}
            portionMultiplier={Number(event.portionMultiplier)}
            markupPct={Number(event.markupPct ?? 0)}
            quotedTotalOverrideCents={event.quotedTotalOverrideCents ?? null}
            laborTotalCents={totalLaborCents}
            isPaid={isPaid}
            canSeeFinancials={canSeeFinancials}
          />

          {/* Kitchen tasks — shown after PAID */}
          {isPaid && (event.kitchenTasks ?? []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Kitchen tasks generated</CardTitle>
                <CardDescription>
                  {prepTasks.length} prep + {serviceTasks.length} service tasks · check inventory checked {formatDateTime(event.inventoryCheckedAt, user.workspaceTimeZone)}
                </CardDescription>
              </CardHeader>
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                  <tr>
                    <th className="text-left px-5 py-2 font-medium">Task</th>
                    <th className="text-right px-5 py-2 font-medium">Portions</th>
                    <th className="text-left px-5 py-2 font-medium">Type</th>
                    <th className="text-left px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border">
                  {(event.kitchenTasks ?? []).map((t) => (
                    <tr key={t.id}>
                      <td className="px-5 py-2 text-text-primary">{t.title}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-text-secondary">{t.targetPortions ?? "—"}</td>
                      <td className="px-5 py-2">
                        <span className={`text-[10px] uppercase tracking-wider ${t.taskType === "PREP" ? "text-warning" : "text-info"}`}>
                          {t.taskType}
                        </span>
                      </td>
                      <td className="px-5 py-2">
                        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">{t.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Ingredient requirements */}
          <Card>
            <CardHeader>
              <CardTitle>
                Ingredient requirements
                {shortItems.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-danger">
                    {shortItems.length} shortage{shortItems.length === 1 ? "" : "s"}
                  </span>
                )}
              </CardTitle>
              <CardDescription>Required vs. current inventory · confirm invoices to update stock</CardDescription>
            </CardHeader>
            {aiSummary && (
              <div className="px-5 py-3 bg-bg-inset border-b border-bg-border">
                <p className="text-xs text-text-secondary font-mono leading-relaxed">{aiSummary}</p>
              </div>
            )}
            {requirements.length === 0 ? (
              <CardBody><EmptyState title="No ingredients computed" description="Add menu items to this event to see requirements." /></CardBody>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                  <tr>
                    <th className="text-left px-5 py-2 font-medium">Ingredient</th>
                    <th className="text-right px-5 py-2 font-medium">Need</th>
                    <th className="text-right px-5 py-2 font-medium">Have</th>
                    <th className="text-right px-5 py-2 font-medium">Gap</th>
                    {canSeeFinancials && <th className="text-right px-5 py-2 font-medium">Last price</th>}
                    {canSeeFinancials && <th className="text-right px-5 py-2 font-medium">Est. cost to reorder</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border">
                  {requirements.map((req) => (
                    <tr
                      key={req.ingredientId}
                      className={req.isShort ? "bg-danger/5" : ""}
                    >
                      <td className="px-5 py-2 text-text-primary">{req.ingredientName}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-text-secondary">
                        {req.requiredDisplay.toFixed(1)} {req.displayUnit}
                      </td>
                      <td className={`px-5 py-2 text-right tabular-nums ${req.isShort ? "text-danger" : "text-success"}`}>
                        {req.currentStockDisplay.toFixed(1)} {req.displayUnit}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums">
                        {req.isShort ? (
                          <span className="text-danger font-medium">
                            −{req.gapDisplay.toFixed(1)} {req.displayUnit}
                          </span>
                        ) : (
                          <span className="text-success text-xs">OK</span>
                        )}
                      </td>
                      {canSeeFinancials && (
                        <td className="px-5 py-2 text-right tabular-nums text-text-tertiary text-xs">
                          {req.lastUnitPriceCents ? formatCents(req.lastUnitPriceCents) : "—"}
                        </td>
                      )}
                      {canSeeFinancials && (
                        <td className="px-5 py-2 text-right tabular-nums text-xs">
                          {req.isShort && req.estCostCents != null ? formatCents(req.estCostCents) : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {canSeeFinancials && shortItems.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-bg-border font-medium">
                      <td className="px-5 py-2 text-text-primary" colSpan={4}>Total est. cost to reorder</td>
                      <td className="px-5 py-2 text-right tabular-nums" />
                      <td className="px-5 py-2 text-right tabular-nums">
                        {formatCents(shortItems.reduce((sum, r) => sum + (r.estCostCents ?? 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </Card>
        </div>

        {/* Right: staff + actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Staff</CardTitle></CardHeader>
            {event.staff.length === 0 ? (
              <CardBody className="text-xs text-text-tertiary">No staff assigned</CardBody>
            ) : (
              <div className="px-5 pb-4 space-y-3">
                {event.staff.map((s) => (
                  <div key={s.id} className="text-sm">
                    <div className="font-medium text-text-primary">
                      {s.user?.displayName ?? s.user?.username ?? "Unassigned"}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {s.role.replace(/_/g, " ").toLowerCase()} ·{" "}
                      {Number(s.hours).toFixed(1)}h
                      {canSeeFinancials && s.hourlyRateCents != null && (
                        <> @ {formatCents(s.hourlyRateCents)}/h ={" "}
                          {formatCents(Math.round(Number(s.hours) * s.hourlyRateCents))}</>
                      )}
                    </div>
                  </div>
                ))}
                {canSeeFinancials && (
                  <div className="pt-2 border-t border-bg-border text-xs text-text-secondary">
                    Total labor: <span className="font-mono">{formatCents(totalLaborCents)}</span>
                  </div>
                )}
              </div>
            )}
          </Card>

          {canSeeFinancials && (
            <DirectCostsCard
              eventId={event.id}
              packagingCostCents={event.packagingCostCents ?? 0}
              deliveryCostCents={event.deliveryCostCents ?? 0}
              equipmentCostCents={event.equipmentCostCents ?? 0}
              otherDirectCostCents={event.otherDirectCostCents ?? 0}
              canEdit={canSeeFinancials}
            />
          )}

          <Card>
            <CardHeader><CardTitle>Kitchen</CardTitle></CardHeader>
            <CardBody className="space-y-2">
              {event.kitchenPacket ? (
                <>
                  <p className="text-xs text-success">
                    Packet last generated {formatDate(event.kitchenPacket.generatedAt, user.workspaceTimeZone)} · for event date {formatDate(event.startsAt, user.workspaceTimeZone)}
                  </p>
                  <Link href={`/${workspace}/kitchen?eventId=${event.id}` as any}>
                    <Button variant="secondary" size="sm" className="w-full">View kitchen board</Button>
                  </Link>
                  <Link href={`/${workspace}/kitchen/event/${event.id}` as any}>
                    <Button variant="secondary" size="sm" className="w-full">Chef prep list</Button>
                  </Link>
                  {isPaid && (
                    <Link href={`/${workspace}/kitchen/event/${event.id}/service` as any}>
                      <Button variant="secondary" size="sm" className="w-full">Staff service list</Button>
                    </Link>
                  )}
                </>
              ) : (
                <p className="text-xs text-text-tertiary">No kitchen packet yet.</p>
              )}
            </CardBody>
          </Card>

          {event.notes && (
            <Card>
              <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
              <CardBody>
                <p className="text-sm text-text-secondary whitespace-pre-wrap">{event.notes}</p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "default" | "warning" | "danger" }) {
  const valueColor = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-text-primary";
  return (
    <div className="rounded-md border border-bg-border bg-bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className={`mt-2 text-xl font-semibold tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-text-secondary">{sub}</div>}
    </div>
  );
}
