// =====================================================================
// apps/api/src/recipes/recipe-yield.helper.ts
// =====================================================================
// #20: Calculated Ingredient Weight per Portion = total ingredient
// weight (in grams, summed across every line) / portionsYielded.
// Pure computation, no DB writes — mirrors recipe-cost.helper.ts's
// shape and is called the same way (by RecipesService.get()).
//
// This is DELIBERATELY separate from Target Portion Weight
// (Recipe.portionWeightG, manually entered) — the two are never
// reconciled anywhere else in the codebase (see NEEDS_ROSHAN.md #20),
// and per instruction neither one overwrites the other here either.
// =====================================================================

import { toCanonical, UnitConversionError } from "@ibirdos/types";

const OZ_PER_GRAM = 1 / 28.3495;

export interface CalculatedWeightLine {
  ingredientId: string;
  name: string;
  weighable: boolean;
  weightG: number | null;
  reason: string | null; // why this line couldn't be weighed, when weighable is false
}

export interface CalculatedPortionWeightResult {
  totalWeightG: number;
  perPortionWeightG: number | null;
  /** true if every ingredient line contributed a real weight; false if
   *  one or more lines were skipped (no density for a VOLUME ingredient,
   *  no weightOz for a COUNT ingredient) -- the total is a partial sum
   *  in that case, not a silently-wrong "complete" number. */
  complete: boolean;
  lines: CalculatedWeightLine[];
}

export interface RecipeForYield {
  portionsYielded?: number | null;
  ingredients: Array<{
    quantity: { toString(): string } | number;
    unit: string;
    weightOz?: { toString(): string } | number | null;
    ingredient: {
      id: string;
      name: string;
      dimension: string;
      densityGPerMl?: { toString(): string } | number | null;
    };
  }>;
}

export function computeCalculatedPortionWeight(recipe: RecipeForYield): CalculatedPortionWeightResult {
  let totalWeightG = 0;
  let complete = true;
  const lines: CalculatedWeightLine[] = [];

  for (const link of recipe.ingredients ?? []) {
    const ing = link.ingredient;
    const qty = Number(link.quantity);

    if (ing.dimension === "MASS") {
      try {
        const grams = toCanonical(qty, link.unit, { dimension: "MASS" as any, densityGPerMl: null });
        totalWeightG += grams;
        lines.push({ ingredientId: ing.id, name: ing.name, weighable: true, weightG: grams, reason: null });
      } catch (err: any) {
        complete = false;
        const msg = err instanceof UnitConversionError ? err.message : String(err?.message ?? err);
        lines.push({ ingredientId: ing.id, name: ing.name, weighable: false, weightG: null, reason: msg });
      }
      continue;
    }

    if (ing.dimension === "VOLUME") {
      const density = ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null;
      if (density == null) {
        complete = false;
        lines.push({
          ingredientId: ing.id, name: ing.name, weighable: false, weightG: null,
          reason: "No density set for this volume ingredient — can't convert to weight",
        });
        continue;
      }
      try {
        const ml = toCanonical(qty, link.unit, { dimension: "VOLUME" as any, densityGPerMl: density });
        const grams = ml * density;
        totalWeightG += grams;
        lines.push({ ingredientId: ing.id, name: ing.name, weighable: true, weightG: grams, reason: null });
      } catch (err: any) {
        complete = false;
        const msg = err instanceof UnitConversionError ? err.message : String(err?.message ?? err);
        lines.push({ ingredientId: ing.id, name: ing.name, weighable: false, weightG: null, reason: msg });
      }
      continue;
    }

    // COUNT dimension: no universal weight-per-each conversion exists --
    // the only per-line weight signal available is the optional
    // RecipeIngredient.weightOz override.
    if (link.weightOz != null) {
      const grams = qty * Number(link.weightOz) / OZ_PER_GRAM;
      totalWeightG += grams;
      lines.push({ ingredientId: ing.id, name: ing.name, weighable: true, weightG: grams, reason: null });
    } else {
      complete = false;
      lines.push({
        ingredientId: ing.id, name: ing.name, weighable: false, weightG: null,
        reason: "COUNT ingredient with no weight-per-unit (weightOz) set",
      });
    }
  }

  const perPortionWeightG =
    recipe.portionsYielded && recipe.portionsYielded > 0
      ? totalWeightG / recipe.portionsYielded
      : null;

  return { totalWeightG, perPortionWeightG, complete, lines };
}
