import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { can, canViewFinancials } from "@ibirdos/permissions";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Badge, Button } from "@ibirdos/ui";
import { IngredientsEditor, type EditableIngredientLine } from "./IngredientsEditor";
import { DeleteRecipeButton } from "./delete-recipe-button";
import { RecipePhotoImg } from "./RecipePhotoImg";
import { YieldVarianceCard } from "./YieldVarianceCard";

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
  // #20: pure computation, present for every role (not a financial field).
  calculatedPortionWeightG: number | null;
  calculatedWeightComplete: boolean;
  // #20: additive, inert-until-migrated -- always present as a key, null
  // until both the migration has run AND a reason has been recorded.
  yieldVarianceReason: string | null;
  yieldVarianceReasonNote: string | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  // Financial fields below are all optional, not just nullable: the API
  // omits them from the response entirely (rather than sending null) for
  // roles without financial visibility (Chef/Staff) -- see
  // canViewFinancials()/stripFinancialFields() in recipes.service.ts. Every
  // read site must handle "key absent" (undefined), not just "key present
  // with a null value".
  goalFoodCostPct?: number | null;
  paperCostCents?: number | null;
  salePriceCents?: number | null;
  // Live cost fields (source of truth)
  liveCostCents?: number | null;
  livePerPortionCostCents?: number | null;
  liveFoodCostPct?: number | null;
  liveMarginPct?: number | null;
  liveStaleness?: "FRESH" | "MISSING_PRICE" | "MISSING_INGREDIENT";
  liveBreakdown?: LiveBreakdownLine[];
  // Cached (may lag by recost debounce window)
  cachedCostCents?: number | null;
  cachedCostUpdatedAt?: string | null;
  // Legacy — kept for backwards compat with non-upgraded clients
  cachedCostMicrocents?: number | null;
  cachedCostPerPortionMicrocents?: number | null;
  photoUrl: string | null;
  prepPhotoUrl: string | null;
  finalPhotoUrl: string | null;
  videoUrl: string | null;
  isPartial?: boolean;
  ingredients: RecipeIngredientLine[];
  createdAt: string;
  updatedAt: string;
}

function fmtCents(cents: number | null | undefined) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function fmtPct(pct: number | null | undefined) {
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
  // recipe.delete -- distinct from recipe.update (canEdit above). CHEF
  // legitimately holds recipe.update to edit steps/ingredients but must
  // not be able to delete recipes; DELETE /recipes/:id now enforces this
  // server-side too (previously checked recipe.update by mistake).
  const canDelete = can(user.role, "recipe.delete");
  // Same signal the API redaction is built on -- if this is false, the API
  // never sent cost/price/margin data for this recipe in the first place.
  const canSeeFinancials = canViewFinancials(user.role);

  const portionWeightOz = recipe.portionWeightG ? (recipe.portionWeightG / 28.3495).toFixed(1) : null;
  const calculatedPortionWeightOz = recipe.calculatedPortionWeightG ? (recipe.calculatedPortionWeightG / 28.3495).toFixed(1) : null;
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
    ? formatDateTime(recipe.cachedCostUpdatedAt, user.workspaceTimeZone)
    : null;

  function FoodCostBadge({ pct }: { pct: number | null | undefined }) {
    // Loose check: catches both `null` (field genuinely has no value) and
    // `undefined` (field was stripped from the API response entirely
    // because this role can't see financials -- see canViewFinancials).
    // A strict `=== null` check here missed the undefined case and crashed
    // on `pct.toFixed(1)` below for Chef/Staff.
    if (pct == null) {
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
            <p className="text-xs text-text-tertiary mt-0.5">
              {recipe.authorName ? `by ${recipe.authorName}` : <span className="italic">No author</span>}
            </p>
          </div>
        </div>
        {(canEdit || canDelete) && (
          <div className="flex items-center gap-2">
            {canEdit && (
              <Link href={`/${workspace}/recipes/${id}/edit` as any}>
                <Button variant="secondary" size="sm">Edit</Button>
              </Link>
            )}
            {canDelete && (
              <DeleteRecipeButton recipeId={id} workspaceSlug={workspace} recipeName={recipe.name} />
            )}
          </div>
        )}
      </div>

      <div className={canSeeFinancials ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : "grid grid-cols-1 gap-6"}>
        <div className={canSeeFinancials ? "lg:col-span-2 space-y-6" : "space-y-6"}>

          {/* Info */}
          <Card>
            <CardHeader>
              <CardTitle>Recipe info</CardTitle>
              <CardDescription>{recipe.category ?? <span className="text-text-tertiary italic">No category</span>}</CardDescription>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-sm text-text-secondary">
                {recipe.description ?? recipe.notes ?? <span className="italic text-text-tertiary">No description</span>}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatBox label="Portions" value={recipe.portionsYielded != null ? String(recipe.portionsYielded) : "—"} />
                {/* #20: relabeled "Portion weight" -> "Target portion weight"
                    now that a second, calculated figure exists alongside it —
                    this one stays exactly what it always was (manually
                    entered, never auto-overwritten). */}
                <StatBox label="Target portion weight" value={portionWeightOz ? `${portionWeightOz} oz` : "—"} />
                <StatBox
                  label="Calculated portion weight"
                  value={calculatedPortionWeightOz ? `${calculatedPortionWeightOz} oz${recipe.calculatedWeightComplete ? "" : "*"}` : "—"}
                />
                <StatBox label="Portion volume" value={portionVolumeFloz ? `${portionVolumeFloz} fl oz` : "—"} />
                <StatBox label="Prep time" value={recipe.prepTimeMin != null ? `${recipe.prepTimeMin} min` : "—"} />
                <StatBox label="Cook time" value={recipe.cookTimeMin != null ? `${recipe.cookTimeMin} min` : "—"} />
              </div>
              {!recipe.calculatedWeightComplete && calculatedPortionWeightOz && (
                <p className="text-[10px] text-text-tertiary">* Calculated weight is a partial sum — one or more ingredient lines couldn't be weighed (missing density or per-unit weight).</p>
              )}
            </CardBody>
          </Card>

          <YieldVarianceCard
            recipeId={id}
            targetWeightG={recipe.portionWeightG}
            calculatedWeightG={recipe.calculatedPortionWeightG}
            calculatedWeightComplete={recipe.calculatedWeightComplete}
            initialReason={recipe.yieldVarianceReason}
            initialNote={recipe.yieldVarianceReasonNote}
            canEdit={canEdit}
          />

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
                canSeeFinancials={canSeeFinancials}
              />
            </CardBody>
          </Card>

          {/* Procedure / Instructions */}
          <Card>
            <CardHeader><CardTitle>Procedure</CardTitle></CardHeader>
            <CardBody>
              {recipe.instructionsMd ? (
                <pre className="whitespace-pre-wrap font-sans text-sm text-text-secondary leading-relaxed">
                  {recipe.instructionsMd}
                </pre>
              ) : (
                <p className="text-sm italic text-text-tertiary">No procedure added yet. <Link href={`/${workspace}/recipes/${id}/edit` as any} className="underline hover:text-text-secondary">Add via Edit.</Link></p>
              )}
            </CardBody>
          </Card>

          {/* Photos & Media */}
          <Card>
            <CardHeader><CardTitle>Photos &amp; Media</CardTitle></CardHeader>
            <CardBody className="flex gap-4 flex-wrap">
              {recipe.photoUrl && !recipe.prepPhotoUrl && !recipe.finalPhotoUrl && (
                <div>
                  <p className="text-xs text-text-tertiary mb-1">Recipe photo</p>
                  <RecipePhotoImg src={recipe.photoUrl} alt="Recipe" label="Recipe" />
                </div>
              )}
              {recipe.prepPhotoUrl ? (
                <div>
                  <p className="text-xs text-text-tertiary mb-1">Prep photo</p>
                  <RecipePhotoImg src={recipe.prepPhotoUrl} alt="Prep" label="Prep" />
                </div>
              ) : (
                <PhotoSlot label="Prep photo" editHref={`/${workspace}/recipes/${id}/edit`} />
              )}
              {recipe.finalPhotoUrl ? (
                <div>
                  <p className="text-xs text-text-tertiary mb-1">Final photo</p>
                  <RecipePhotoImg src={recipe.finalPhotoUrl} alt="Final" label="Final" />
                </div>
              ) : (
                <PhotoSlot label="Final photo" editHref={`/${workspace}/recipes/${id}/edit`} />
              )}
              {recipe.videoUrl ? (
                <div>
                  <p className="text-xs text-text-tertiary mb-1">Demo video</p>
                  <span className="text-xs text-text-secondary truncate max-w-[200px] block">{recipe.videoUrl}</span>
                </div>
              ) : (
                <PhotoSlot label="Demo video" editHref={`/${workspace}/recipes/${id}/edit`} />
              )}
            </CardBody>
          </Card>
        </div>

        {/* Cost summary sidebar -- omitted entirely (not a card full of
            dashes) for roles without financial visibility. The API never
            sent this data for this role in the first place. */}
        {canSeeFinancials && (
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
                      label="Actual food cost % (calculated)"
                      value={fmtPct(foodCostPct)}
                      title="Ingredient cost as a % of sell price. Colored against Goal food cost % below, but not driven by it."
                      {...(foodCostPct != null && {
                        valueClass: foodCostPct <= (recipe.goalFoodCostPct ?? 30)
                          ? "text-success font-medium"
                          : "text-danger font-medium",
                      })}
                    />
                    {recipe.goalFoodCostPct != null && (
                      <CostRow
                        label="Goal food cost % (reference)"
                        value={fmtPct(recipe.goalFoodCostPct)}
                        title="A reference line only, set on the Edit page — flags the row above red/green. Does not set the sell price; Target margin % does that."
                      />
                    )}
                    <CostRow
                      label="Margin per portion (calculated)"
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
        )}
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

function CostRow({ label, value, valueClass, title }: { label: string; value: string; valueClass?: string; title?: string }) {
  return (
    <div className="flex justify-between items-center text-xs" title={title}>
      <span className="text-text-secondary">{label}</span>
      <span className={valueClass ?? "tabular-nums text-text-primary font-medium"}>{value}</span>
    </div>
  );
}

function PhotoSlot({ label, editHref }: { label: string; editHref: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-bg-border bg-bg-inset w-28 h-20 gap-1">
      <p className="text-[10px] text-text-tertiary font-medium">{label}</p>
      <Link href={editHref as any} className="text-[10px] text-accent-400 hover:text-accent-300 underline">Add via Edit</Link>
    </div>
  );
}
