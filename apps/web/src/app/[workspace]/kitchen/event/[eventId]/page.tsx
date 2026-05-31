import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, EmptyState } from "@ibirdos/ui";
import { formatDate } from "@/lib/format";

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

interface EventSummary {
  id: string;
  name: string;
  startsAt: string;
  guestCount: number;
  kitchenPacket: {
    ingredientsJson: Array<{
      ingredientId: string;
      name: string;
      totalCanonical: number;
      canonicalUnit: string;
      displayQty: string;
    }>;
  } | null;
  menuItems: Array<{
    recipe: { name: string };
    portions: number;
  }>;
}

export default async function ConsolidatedPrepPage({
  params,
}: {
  params: Promise<{ workspace: string; eventId: string }>;
}) {
  const { workspace, eventId } = await params;
  const user = await requireSession();
  const c = await cookies();

  const [eventRes, reqRes] = await Promise.all([
    api.get<EventSummary>(`/events/${eventId}`, { cookies: c }),
    api.get<IngredientRequirement[]>(`/events/${eventId}/ingredient-requirements`, { cookies: c }),
  ]);

  if (!eventRes.data) notFound();
  const event = eventRes.data;
  const requirements = reqRes.data ?? [];

  // Get ingredient totals from the kitchen packet (most accurate — accounts for exact portions)
  const packetIngredients = (event.kitchenPacket?.ingredientsJson ?? []) as Array<{
    ingredientId: string; name: string; displayQty: string; totalCanonical: number; canonicalUnit: string;
  }>;

  // Merge packet data with stock status from requirements
  const reqByIngId = new Map(requirements.map((r) => [r.ingredientId, r]));

  const consolidatedLines = packetIngredients.map((pi) => {
    const req = reqByIngId.get(pi.ingredientId);
    return {
      ...pi,
      isShort: req?.isShort ?? false,
      currentStockDisplay: req?.currentStockDisplay ?? null,
      displayUnit: req?.displayUnit ?? pi.canonicalUnit,
    };
  }).sort((a, b) => (b.isShort ? 1 : 0) - (a.isShort ? 1 : 0));

  const shortCount = consolidatedLines.filter((l) => l.isShort).length;

  return (
    <div className="space-y-6 max-w-[900px]">
      <div>
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Link href={`/${workspace}/events/${eventId}` as any} className="hover:text-accent-500">
            ← {event.name}
          </Link>
          <span>·</span>
          <Link href={`/${workspace}/kitchen` as any} className="hover:text-accent-500">Kitchen</Link>
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Consolidated prep list</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">
          {event.name} · {event.guestCount} guests · {formatDate(event.startsAt)} ·{" "}
          {event.menuItems.length} dish{event.menuItems.length === 1 ? "" : "es"}
          {shortCount > 0 && ` · `}
          {shortCount > 0 && <span className="text-danger">{shortCount} shortage{shortCount === 1 ? "" : "s"}</span>}
        </p>
      </div>

      {/* Summary of dishes */}
      <Card>
        <CardHeader>
          <CardTitle>Dishes in this event</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {event.menuItems.map((mi, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-bg-inset border border-bg-border text-xs text-text-secondary"
              >
                {mi.recipe.name} <span className="text-text-tertiary">×{mi.portions}</span>
              </span>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Consolidated ingredient list */}
      <Card>
        <CardHeader>
          <CardTitle>Total ingredients to prep</CardTitle>
          <CardDescription>
            All recipes combined · use this for bulk prep before service
          </CardDescription>
        </CardHeader>
        {consolidatedLines.length === 0 ? (
          <CardBody>
            <EmptyState
              title="No kitchen packet generated"
              description="Go to the event and generate a kitchen packet first."
            />
          </CardBody>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Ingredient</th>
                <th className="text-right px-5 py-3 font-medium">Total needed</th>
                <th className="text-right px-5 py-3 font-medium">In stock</th>
                <th className="text-left px-5 py-3 font-medium w-20">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {consolidatedLines.map((line) => (
                <tr
                  key={line.ingredientId}
                  className={line.isShort ? "bg-danger/5" : ""}
                >
                  <td className="px-5 py-3 text-text-primary font-medium">{line.name}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-primary">{line.displayQty}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">
                    {line.currentStockDisplay != null
                      ? `${line.currentStockDisplay.toFixed(1)} ${line.displayUnit}`
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    {line.isShort ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-danger">
                        <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block" />Short
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-success">
                        <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />OK
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {shortCount > 0 && (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-5 py-4 text-sm text-danger">
          {shortCount} ingredient{shortCount === 1 ? " is" : "s are"} short.{" "}
          <Link href={`/${workspace}/invoices/new` as any} className="underline hover:no-underline">
            Upload an invoice
          </Link>{" "}
          or{" "}
          <Link href={`/${workspace}/inventory/adjust` as any} className="underline hover:no-underline">
            manually adjust inventory
          </Link>{" "}
          to resolve.
        </div>
      )}
    </div>
  );
}
