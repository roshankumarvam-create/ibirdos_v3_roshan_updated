import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Badge, Button, EmptyState } from "@ibirdos/ui";
import { formatCents, formatPct, formatDateTime, formatDate } from "@/lib/format";

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
  quotedPriceCents: number | null;
  computedFoodCostCents: number | null;
  computedLaborCostCents: number | null;
  computedMarginPct: number | null;
  notes: string | null;
  // Cost freeze fields
  frozenAt: string | null;
  frozenRecipeCostsCents: Record<string, number> | null;
  frozenIngredientPricesCents: Record<string, number> | null;
  menuItems: Array<{
    id: string;
    recipeId: string;
    portions: number;
    displayOrder: number;
    recipe: { id: string; name: string; portionsYielded: number | null; cachedCostMicrocents: string | null; salePriceCents: number | null };
  }>;
  staff: Array<{
    id: string;
    role: string;
    hours: number;
    hourlyRateCents: number;
    user: { id: string; username: string; displayName: string | null } | null;
  }>;
  kitchenPacket: { id: string; generatedAt: string } | null;
}

interface IngredientRequirement {
  ingredientId: string;
  ingredientName: string;
  displayUnit: string;
  requiredDisplay: number;
  currentStockDisplay: number;
  gapDisplay: number;
  isShort: boolean;
  lastUnitPriceCents: number | null;
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

  const [eventRes, reqRes] = await Promise.all([
    api.get<EventDetail>(`/events/${id}`, { cookies: c }),
    api.get<IngredientRequirement[]>(`/events/${id}/ingredient-requirements`, { cookies: c }),
  ]);

  if (!eventRes.data) notFound();
  const event = eventRes.data;
  const requirements = reqRes.data ?? [];

  const totalLaborCents = event.staff.reduce(
    (sum, s) => sum + Math.round(Number(s.hours) * s.hourlyRateCents),
    0,
  );
  const shortItems = requirements.filter((r) => r.isShort);

  // Simple AI-style summary string
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
            {formatDateTime(event.startsAt)}
            {event.venueAddress && ` · ${event.venueAddress}`}
            {event.customerName && ` · ${event.customerName}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={STATUS_TONE[event.status] ?? "neutral"}>
            {event.status.toLowerCase().replace(/_/g, " ")}
          </Badge>
          {event.frozenAt ? (
            <span
              className="inline-flex items-center gap-1 rounded border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 text-[10px] font-medium text-accent-400"
              title={`Costs locked at ${new Date(event.frozenAt).toLocaleString()}`}
            >
              🔒 Frozen quote · {new Date(event.frozenAt).toLocaleDateString()}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              Live quote
            </span>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Guests" value={event.guestCount.toString()} />
        <KpiCard label="Revenue" value={formatCents(event.quotedPriceCents)} />
        <KpiCard
          label={event.frozenAt ? "Food cost (frozen)" : "Food cost"}
          value={formatCents(event.computedFoodCostCents)}
          {...(event.quotedPriceCents && event.computedFoodCostCents
            ? { sub: `${formatPct((event.computedFoodCostCents / event.quotedPriceCents) * 100)} of revenue` }
            : {})}
        />
        <KpiCard
          label="Margin"
          value={formatPct(event.computedMarginPct)}
          tone={event.computedMarginPct != null
            ? event.computedMarginPct < 25 ? "danger" : event.computedMarginPct < 45 ? "warning" : "default"
            : "default"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: menu + staff */}
        <div className="lg:col-span-2 space-y-6">
          {/* Menu */}
          <Card>
            <CardHeader>
              <CardTitle>Menu ({event.menuItems.length} item{event.menuItems.length === 1 ? "" : "s"})</CardTitle>
              <CardDescription>{event.guestCount} guests · ×{Number(event.portionMultiplier).toFixed(2)} multiplier</CardDescription>
            </CardHeader>
            {event.menuItems.length === 0 ? (
              <CardBody><EmptyState title="No menu items" description="Add recipes to this event to generate a kitchen packet." /></CardBody>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                  <tr>
                    <th className="text-left px-5 py-2 font-medium">Recipe</th>
                    <th className="text-right px-5 py-2 font-medium">Portions</th>
                    <th className="text-right px-5 py-2 font-medium">Food cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border">
                  {event.menuItems.map((mi) => (
                    <tr key={mi.id}>
                      <td className="px-5 py-2">
                        <Link
                          href={`/${workspace}/recipes/${mi.recipe.id}` as any}
                          className="text-text-primary hover:text-accent-500"
                        >
                          {mi.recipe.name}
                        </Link>
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums text-text-secondary">{mi.portions}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-text-secondary">
                        {mi.recipe.cachedCostMicrocents
                          ? formatCents(Math.round(Number(mi.recipe.cachedCostMicrocents) * mi.portions / 1000))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

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
                    <th className="text-right px-5 py-2 font-medium">Last price</th>
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
                      <td className="px-5 py-2 text-right tabular-nums text-text-tertiary text-xs">
                        {req.lastUnitPriceCents ? formatCents(req.lastUnitPriceCents) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
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
                      {Number(s.hours).toFixed(1)}h @ {formatCents(s.hourlyRateCents)}/h ={" "}
                      {formatCents(Math.round(Number(s.hours) * s.hourlyRateCents))}
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-bg-border text-xs text-text-secondary">
                  Total labor: <span className="font-mono">{formatCents(totalLaborCents)}</span>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader><CardTitle>Kitchen</CardTitle></CardHeader>
            <CardBody className="space-y-2">
              {event.kitchenPacket ? (
                <>
                  <p className="text-xs text-success">Packet generated {formatDate(event.kitchenPacket.generatedAt)}</p>
                  <Link href={`/${workspace}/kitchen?eventId=${event.id}` as any}>
                    <Button variant="secondary" size="sm" className="w-full">View kitchen board</Button>
                  </Link>
                  <Link href={`/${workspace}/kitchen/event/${event.id}` as any}>
                    <Button variant="secondary" size="sm" className="w-full">Consolidated prep list</Button>
                  </Link>
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
