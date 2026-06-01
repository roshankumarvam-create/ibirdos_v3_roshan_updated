// =====================================================================
// apps/api/src/recipes/recipe-cost.helper.ts
// =====================================================================
// Pure computation function — no DB writes, no side effects.
// Called by RecipesService for both the list/detail API response AND
// by the recost worker before writing back to the cache column.
//
// Architectural note: this belongs conceptually in packages/db, but
// lives here to avoid adding @ibirdos/types as a dep to that package.
// If we ever split the worker into its own package, extract this file.
// =====================================================================

import { toCanonical, UnitConversionError } from "@ibirdos/types";

export interface LiveCostBreakdownLine {
  ingredientId: string;
  name: string;
  quantity: number;
  unit: string;
  currentPricePerCanonicalCents: number | null;
  lineCostCents: number | null;
  error: string | null;
}

export interface LiveCostResult {
  totalCostCents: number;
  perPortionCostCents: number | null;
  foodCostPct: number | null;
  marginPct: number | null;
  breakdown: LiveCostBreakdownLine[];
  staleness: "FRESH" | "MISSING_PRICE" | "MISSING_INGREDIENT";
}

export interface RecipeForCost {
  portionsYielded?: number | null;
  salePriceCents?: number | null;
  ingredients: Array<{
    id: string;
    quantity: { toString(): string } | number;
    unit: string;
    yieldPctOverride?: { toString(): string } | number | null;
    ingredient: {
      id: string;
      name: string;
      dimension: string;
      canonicalUnit: string;
      densityGPerMl?: { toString(): string } | number | null;
      currentCostMicrocents?: bigint | null;
      defaultYieldPct?: { toString(): string } | number;
    };
  }>;
}

export function computeLiveRecipeCost(recipe: RecipeForCost): LiveCostResult {
  if (!recipe.ingredients || recipe.ingredients.length === 0) {
    return {
      totalCostCents: 0,
      perPortionCostCents: null,
      foodCostPct: null,
      marginPct: null,
      breakdown: [],
      staleness: "MISSING_INGREDIENT",
    };
  }

  let totalCostMicrocents = 0;
  let hasMissingPrice = false;
  const breakdown: LiveCostBreakdownLine[] = [];

  for (const link of recipe.ingredients) {
    const ing = link.ingredient;

    if (ing.currentCostMicrocents == null) {
      hasMissingPrice = true;
      breakdown.push({
        ingredientId: ing.id,
        name: ing.name,
        quantity: Number(link.quantity),
        unit: link.unit,
        currentPricePerCanonicalCents: null,
        lineCostCents: null,
        error: `No price set for "${ing.name}"`,
      });
      continue;
    }

    try {
      const canonicalQty = toCanonical(Number(link.quantity), link.unit, {
        dimension: ing.dimension as any,
        densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
      });

      const yieldPct = Number(link.yieldPctOverride ?? ing.defaultYieldPct ?? 100);
      const effectiveQty = yieldPct > 0 ? canonicalQty * (100 / yieldPct) : canonicalQty;

      const lineMicrocents = effectiveQty * Number(ing.currentCostMicrocents);
      totalCostMicrocents += lineMicrocents;

      breakdown.push({
        ingredientId: ing.id,
        name: ing.name,
        quantity: Number(link.quantity),
        unit: link.unit,
        currentPricePerCanonicalCents: Number(ing.currentCostMicrocents) / 1000,
        lineCostCents: lineMicrocents / 1000,
        error: null,
      });
    } catch (err: any) {
      hasMissingPrice = true;
      const msg = err instanceof UnitConversionError
        ? `${err.message} (${err.code})`
        : err.message;
      breakdown.push({
        ingredientId: ing.id,
        name: ing.name,
        quantity: Number(link.quantity),
        unit: link.unit,
        currentPricePerCanonicalCents: null,
        lineCostCents: null,
        error: msg,
      });
    }
  }

  const totalCostCents = totalCostMicrocents / 1000;
  const perPortionCostCents =
    recipe.portionsYielded && recipe.portionsYielded > 0
      ? totalCostCents / recipe.portionsYielded
      : null;

  let foodCostPct: number | null = null;
  let marginPct: number | null = null;
  if (recipe.salePriceCents && recipe.salePriceCents > 0 && perPortionCostCents != null) {
    foodCostPct = (perPortionCostCents / recipe.salePriceCents) * 100;
    marginPct = ((recipe.salePriceCents - perPortionCostCents) / recipe.salePriceCents) * 100;
  }

  return {
    totalCostCents,
    perPortionCostCents,
    foodCostPct,
    marginPct,
    breakdown,
    staleness: hasMissingPrice ? "MISSING_PRICE" : "FRESH",
  };
}
