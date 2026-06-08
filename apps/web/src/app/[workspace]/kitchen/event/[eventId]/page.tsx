import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, EmptyState, Badge } from "@ibirdos/ui";
import { formatDate } from "@/lib/format";

const CHEF_ROLES = ["OWNER", "MANAGER", "CHEF"] as const;

interface ScaledIngredient {
  ingredientId: string;
  name: string;
  neededCanonical: number;
  canonicalUnit: string;
  displayQty: string;
  currentStockCanonical: number;
}

interface KitchenTask {
  id: string;
  title: string;
  recipeId: string | null;
  targetPortions: number | null;
  taskType: string;
  status: string;
  estimatedMinutes: number | null;
  scaledIngredients: ScaledIngredient[] | null;
}

interface EventSummary {
  id: string;
  name: string;
  startsAt: string;
  guestCount: number;
  customerName: string | null;
  paymentStatus: string;
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
  kitchenTasks: KitchenTask[];
}

export default async function ChefPrepPage({
  params,
}: {
  params: Promise<{ workspace: string; eventId: string }>;
}) {
  const { workspace, eventId } = await params;
  const user = await requireSession();

  // RBAC: only CHEF or higher
  if (!CHEF_ROLES.includes(user.role as any)) redirect("/403");

  const c = await cookies();
  const eventRes = await api.get<EventSummary>(`/events/${eventId}`, { cookies: c });

  if (!eventRes.data) notFound();
  const event = eventRes.data;

  const prepTasks = (event.kitchenTasks ?? []).filter((t) => t.taskType === "PREP");
  const totalPortions = event.menuItems.reduce((s, m) => s + m.portions, 0);
  const isPaid = event.paymentStatus === "PAID";

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
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Chef prep list</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">
          {event.name} · {event.guestCount} guests{event.customerName && ` · ${event.customerName}`} · {formatDate(event.startsAt)} ·{" "}
          {totalPortions} total portions
        </p>
        {isPaid && (
          <div className="mt-2">
            <Badge tone="success">PAID — Kitchen tasks confirmed</Badge>
          </div>
        )}
        {!isPaid && (
          <div className="mt-2 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            Event not yet marked PAID. Showing consolidated ingredient list from kitchen packet.
          </div>
        )}
      </div>

      {/* Per-recipe prep sections — from PREP kitchen tasks */}
      {isPaid && prepTasks.length > 0 ? (
        <div className="space-y-4">
          {prepTasks.map((task) => {
            const ingredients = task.scaledIngredients ?? [];
            return (
              <Card key={task.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{task.title.replace(/^PREP:\s*/i, "")}</CardTitle>
                      <CardDescription>
                        {task.targetPortions} portions
                        {task.estimatedMinutes ? ` · ~${task.estimatedMinutes} min` : ""}
                      </CardDescription>
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                      task.status === "DONE"
                        ? "text-success border-success/30 bg-success/5"
                        : "text-text-tertiary border-bg-border bg-bg-inset"
                    }`}>
                      {task.status}
                    </span>
                  </div>
                </CardHeader>
                {ingredients.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                      <tr>
                        <th className="text-left px-5 py-2 font-medium">Ingredient</th>
                        <th className="text-right px-5 py-2 font-medium">Needed</th>
                        <th className="text-right px-5 py-2 font-medium">In stock</th>
                        <th className="text-left px-5 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bg-border">
                      {ingredients.map((ing) => {
                        const sufficient = ing.currentStockCanonical >= ing.neededCanonical;
                        return (
                          <tr key={ing.ingredientId} className={sufficient ? "" : "bg-danger/5"}>
                            <td className="px-5 py-2 text-text-primary font-medium">{ing.name}</td>
                            <td className="px-5 py-2 text-right tabular-nums text-text-primary">
                              {ing.displayQty}
                            </td>
                            <td className="px-5 py-2 text-right tabular-nums text-text-secondary">
                              {ing.currentStockCanonical.toFixed(2)} {ing.canonicalUnit}
                            </td>
                            <td className="px-5 py-2">
                              {sufficient ? (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-success">
                                  <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />OK
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-danger">
                                  <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block" />Short
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <CardBody>
                    <EmptyState title="No ingredient data" description="Ingredient quantities were not scaled for this task." />
                  </CardBody>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        /* Fallback: consolidated ingredient list from kitchen packet (pre-PAID) */
        <>
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

          <Card>
            <CardHeader>
              <CardTitle>Total ingredients to prep</CardTitle>
              <CardDescription>All recipes combined · consolidated from kitchen packet</CardDescription>
            </CardHeader>
            {(event.kitchenPacket?.ingredientsJson ?? []).length === 0 ? (
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border">
                  {(event.kitchenPacket?.ingredientsJson ?? []).map((line: any) => (
                    <tr key={line.ingredientId}>
                      <td className="px-5 py-3 text-text-primary font-medium">{line.name}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-text-primary">{line.displayQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* Link to service page */}
      {isPaid && (
        <div className="text-xs text-text-tertiary">
          Staff service list:{" "}
          <Link href={`/${workspace}/kitchen/event/${eventId}/service` as any} className="underline hover:text-accent-400">
            View service tasks →
          </Link>
        </div>
      )}
    </div>
  );
}
