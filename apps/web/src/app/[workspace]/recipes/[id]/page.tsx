import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Badge, Button } from "@ibirdos/ui";
import { IngredientsEditor, type EditableIngredientLine } from "./IngredientsEditor";

interface RecipeIngredientLine extends EditableIngredientLine {}

interface LiveBreakdownLine {
  ingredientId: string;
  name: string;
  quantity: number;
  unit: string;
  currentPricePerCanonicalCents: number | null;
  lineCostCents: number | null;
  error: string | null;
}

interface RecipeDetail {
  id: string;
  name: string;
  authorName: string | null;
  category: string | null;
  description: string | null;
  notes: string | null;
  instructionsMd: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  portionsYielded: number | null;
  portionWeightG: number | null;
  portionVolumeMl: number | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  goalFoodCostPct: number | null;
  paperCostCents: number | null;
  salePriceCents: number | null;
  // Live cost fields (source of truth)
  liveCostCents: number;
  livePerPortionCostCents: number | null;
  liveFoodCostPct: number | null;
  liveMarginPct: number | null;
  liveStaleness: "FRESH" | "MISSING_PRICE" | "MISSING_INGREDIENT";
  liveBreakdown: LiveBreakdownLine[];
  // Cached (may lag by recost debounce window)
  cachedCostCents: number | null;
  cachedCostUpdatedAt: string | null;
  // Legacy — kept for backwards compat with non-upgraded clients
  cachedCostMicrocents: number | null;
  cachedCostPerPortionMicrocents: number | null;
  prepPhotoUrl: string | null;
  finalPhotoUrl: string | null;
  videoUrl: string | null;
  isPartial?: boolean;
  ingredients: RecipeIngredientLine[];
  createdAt: string;
  updatedAt: string;
}

function fmtCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function fmtPct(pct: number | null) {
  if (pct == null) return "—";
  return `${pct.toFixed(1)}%`;
}

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = await params;
  const user = await requireSession();
  const c = await cookies();

  const res = await api.get<RecipeDetail>(`/recipes/${id}`, { cookies: c });
  if (res.error || !res.data) notFound();
  const recipe = res.data;

  const canEdit = user.role === "OWNER" || user.role === "MANAGER" || user.role === "CHEF";

  const portionWeightOz = recipe.portionWeightG ? (recipe.portionWeightG / 28.3495).toFixed(1) : null;
  const portionVolumeFloz = recipe.portionVolumeMl ? (recipe.portionVolumeMl / 29.5735).toFixed(1) : null;

  const statusTone = recipe.status === "ACTIVE" ? "success" : recipe.status === "ARCHIVED" ? "neutral" : "warning";

  // Live cost — always reflects current ingredient prices (source of truth)
  const liveCostCents = recipe.liveCostCents;
  const portionCostCents = recipe.livePerPortionCostCents;
  const foodCostPct = recipe.liveFoodCostPct;
  const marginCents: number | null = portionCostCents != null && recipe.salePriceCents != null
    ? recipe.salePriceCents - portionCostCents
    : null;

  // Cache timestamp for tooltip
  const cacheUpdatedAt = recipe.cachedCostUpdatedAt
    ? new Date(recipe.cachedCostUpdatedAt).toLocaleString()
    : null;

  function FoodCostBadge({ pct }: { pct: number | null }) {
    if (pct === null) {
      return (
        <div className="rounded-lg border border-bg-border bg-bg-inset px-4 py-2 text-center">
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary">Food cost</div>
          <div className="mt-1 text-lg font-semibold text-text-tertiary">—</div>
          <div className="text-[10px] text-text-tertiary">No sell price</div>
        </div>
      );
    }
    const { label, colorClass, bgClass } = pct <= 30
      ? { label: "OK", colorClass: "text-success", bgClass: "bg-success/10 border-success/30" }
      : pct <= 35
        ? { label: "WATCH", colorClass: "text-warning", bgClass: "bg-warning/10 border-warning/30" }
        : { label: "HIGH", colorClass: "text-danger", bgClass: "bg-danger/10 border-danger/30" };
    return (
      <div className={`rounded-lg border px-4 py-2 text-center ${bgClass}`}>
        <div className="text-[10px] uppercase tracking-wider text-text-tertiary">Food cost</div>
        <div className={`mt-1 text-lg font-semibold ${colorClass}`}>{pct.toFixed(1)}%</div>
        <div className={`text-xs font-medium ${colorClass}`}>{label}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px] pb-10">
      {/* Partial recipe banner */}
      {recipe.isPartial && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning flex items-start gap-2">
          <span className="text-base leading-none mt-0.5">📄</span>
          <span>
            <strong>Page 1 of multi-page recipe.</strong> Upload additional pages or add the remaining
            ingredients and procedure manually. Costing works with what&apos;s been extracted so far.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href={`/${workspace}/recipes` as any}>
            <Button variant="ghost" size="sm">← Back</Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{recipe.name}</h1>
              <Badge tone={statusTone}>{recipe.status.toLowerCase()}</Badge>
            </div>
            {recipe.authorName && (
              <p className="text-xs text-text-tertiary mt-0.5">by {recipe.authorName}</p>
            )}
          </div>
        </div>
        {canEdit && (
          <Link href={`/${workspace}/recipes/${id}/edit` as any}>
            <Button variant="secondary">Edit recipe</Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* Info */}
          <Card>
            <CardHeader>
              <CardTitle>Recipe info</CardTitle>
              {recipe.category && <CardDescription>{recipe.category}</CardDescription>}
            </CardHeader>
            <CardBody className="space-y-4">
              {(recipe.description || recipe.notes) && (
                <p className="text-sm text-text-secondary">{recipe.description ?? recipe.notes}</p>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {recipe.portionsYielded != null && (
                  <StatBox label="Portions" value={String(recipe.portionsYielded)} />
                )}
                {portionWeightOz && (
                  <StatBox label="Portion weight" value={`${portionWeightOz} oz`} />
                )}
                {portionVolumeFloz && (
                  <StatBox label="Portion volume" value={`${portionVolumeFloz} fl oz`} />
                )}
                {recipe.prepTimeMin != null && (
                  <StatBox label="Prep time" value={`${recipe.prepTimeMin} min`} />
                )}
                {recipe.cookTimeMin != null && (
                  <StatBox label="Cook time" value={`${recipe.cookTimeMin} min`} />
                )}
              </div>
            </CardBody>
          </Card>

          {/* Ingredients */}
          <Card>
            <CardHeader>
              <CardTitle>Ingredients</CardTitle>
              {canEdit && (
                <p className="text-[10px] text-text-tertiary mt-0.5">
                  Click any field to edit. Changes save automatically on blur.
                  Rows with <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-warning/20 text-warning text-[8px] font-bold">!</span> have low-confidence conversions — hover for details.
                </p>
              )}
            </CardHeader>
            <CardBody className="p-0">
              <IngredientsEditor
                recipeId={id}
                workspaceId={workspace}
                lines={recipe.ingredients ?? []}
                canEdit={canEdit}
              />
            </CardBody>
          </Card>

          {/* Procedure / Instructions */}
          {(recipe.instructionsMd) && (
            <Card>
              <CardHeader><CardTitle>Procedure</CardTitle></CardHeader>
              <CardBody>
                <pre className="whitespace-pre-wrap font-sans text-sm text-text-secondary leading-relaxed">
                  {recipe.instructionsMd}
                </pre>
              </CardBody>
            </Card>
          )}

          {/* Photos */}
          {(recipe.prepPhotoUrl || recipe.finalPhotoUrl) && (
            <Card>
              <CardHeader><CardTitle>Photos</CardTitle></CardHeader>
              <CardBody className="flex gap-4 flex-wrap">
                {recipe.prepPhotoUrl && (
                  <div>
                    <p className="text-xs text-text-tertiary mb-1">Prep</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={recipe.prepPhotoUrl} alt="Prep" className="h-32 w-auto rounded object-cover border border-bg-border" />
                  </div>
                )}
                {recipe.finalPhotoUrl && (
                  <div>
                    <p className="text-xs text-text-tertiary mb-1">Final</p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={recipe.finalPhotoUrl} alt="Final" className="h-32 w-auto rounded object-cover border border-bg-border" />
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        {/* Cost summary sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-6">
            <Card>
              <CardHeader>
                <CardTitle>Cost summary</CardTitle>
                {cacheUpdatedAt && (
                  <p className="text-[10px] text-text-tertiary mt-0.5" title={`Cache last written: ${cacheUpdatedAt}`}>
                    Cache updated {cacheUpdatedAt}
                  </p>
                )}
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <FoodCostBadge pct={foodCostPct} />
                {recipe.liveStaleness === "MISSING_PRICE" && (
                  <p className="text-[10px] text-warning">Some ingredients have no price set — cost is partial.</p>
                )}
                <CostRow label="Live ingredient cost" value={fmtCents(liveCostCents)} />
                {recipe.paperCostCents != null && recipe.portionsYielded && (
                  <CostRow
                    label="Paper cost (total)"
                    value={fmtCents(recipe.paperCostCents * recipe.portionsYielded)}
                  />
                )}
                <CostRow label="Portion cost" value={fmtCents(portionCostCents)} />

                <div className="border-t border-bg-border pt-2 mt-2 space-y-2">
                  <CostRow label="Sell price" value={fmtCents(recipe.salePriceCents)} />
                  <CostRow
                    label="Food cost %"
                    value={fmtPct(foodCostPct)}
                    {...(foodCostPct != null && {
                      valueClass: foodCostPct <= (recipe.goalFoodCostPct ?? 30)
                        ? "text-success font-medium"
                        : "text-danger font-medium",
                    })}
                  />
                  {recipe.goalFoodCostPct != null && (
                    <CostRow label="Goal food cost %" value={fmtPct(recipe.goalFoodCostPct)} />
                  )}
                  <CostRow
                    label="Margin per portion"
                    value={fmtCents(marginCents)}
                    {...(marginCents != null && {
                      valueClass: marginCents >= 0 ? "text-success font-medium" : "text-danger font-medium",
                    })}
                  />
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-bg-border bg-bg-inset px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-text-primary">{value}</div>
    </div>
  );
}

function CostRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className={valueClass ?? "tabular-nums text-text-primary font-medium"}>{value}</span>
    </div>
  );
}
