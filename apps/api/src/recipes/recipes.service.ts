// =====================================================================
// apps/api/src/recipes/recipes.service.ts
// =====================================================================
// CRUD + cost engine. The cost engine is the key piece:
//
//   computeRecipeCost(recipeId) walks each RecipeIngredient line,
//   converts the line's quantity to the ingredient's canonical unit
//   via toCanonical(), multiplies by the ingredient's current
//   microcents-per-canonical, applies yield loss, sums everything.
//
// If any line can't be costed (missing density for cross-dim convert,
// or no current price), the recipe's costStaleness is set to
// COMPUTE_ERROR with the reason, and the partial cost is not saved
// (better to surface "we can't cost this" than silently underreport).
// =====================================================================

import {
  Injectable, NotFoundException, BadRequestException, Inject,
} from "@nestjs/common";
import * as xlsx from "xlsx";
import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import {
  toCanonical, UnitConversionError,
  type UnitDimension,
} from "@ibirdos/types";

import { REDIS_CLIENT } from "../common/constants/tokens";
import { computeLiveRecipeCost } from "./recipe-cost.helper";
import { parseXLSX } from "./recipe-spreadsheet-parser";

const log = moduleLogger("RecipesService");

const MICROCENTS_PER_CENT = 1000n;

// ---------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------

export interface RecipeIngredientLineInput {
  ingredientId: string;
  externalCode?: string;
  quantity: number;
  unit: string;
  yieldPctOverride?: number | null;
  /** percentUtilized maps to yieldPctOverride (1–200, default 100) */
  percentUtilized?: number;
  weightOz?: number;
  notes?: string;
}

export interface CreateRecipeInput {
  name: string;
  authorName?: string;
  category?: string;
  description?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  prepTimeMin?: number;
  prepTimeMinutes?: number;
  cookTimeMin?: number;
  cookTimeMinutes?: number;
  portionsYielded?: number;
  totalPortions?: number;
  portionWeightG?: number;
  portionVolumeMl?: number;
  totalYieldCanonical?: number;
  totalYieldDimension?: UnitDimension;
  salePriceCents?: number;
  actualSellPriceCents?: number;
  goalFoodCostPct?: number;
  targetMarginPct?: number;
  paperCostCents?: number;
  autoReprice?: boolean;
  photoUrl?: string;
  prepPhotoUrl?: string;
  finalPhotoUrl?: string;
  videoUrl?: string;
  instructionsMd?: string;
  procedure?: string;
  notes?: string;
  ingredients?: RecipeIngredientLineInput[];
  /** ingredientLines is the new-form alias for ingredients */
  ingredientLines?: RecipeIngredientLineInput[];
}

export type UpdateRecipeInput = Partial<Omit<CreateRecipeInput, "ingredients" | "ingredientLines">> & {
  photoUrl?: string | null;
  prepPhotoUrl?: string | null;
  finalPhotoUrl?: string | null;
  videoUrl?: string | null;
};

// ---------------------------------------------------------------------
// Compute result
// ---------------------------------------------------------------------

export interface RecipeCostBreakdown {
  totalMicrocents: bigint;
  perPortionMicrocents: bigint | null;
  marginPct: number | null;
  staleness: "FRESH" | "STALE" | "RECOSTING" | "COMPUTE_ERROR" | "NO_INGREDIENTS";
  computeError: string | null;
  lines: Array<{
    recipeIngredientId: string;
    ingredientId: string;
    ingredientName: string;
    quantity: number;
    unit: string;
    canonicalQty: number | null;
    lineCostMicrocents: bigint | null;
    error: string | null;
  }>;
}

@Injectable()
export class RecipesService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // -----------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------

  async create(ctx: TenantContext, input: CreateRecipeInput) {
    // Normalize aliased field names from the new-form API
    const lines = input.ingredientLines ?? input.ingredients ?? [];
    const portionsYielded = input.totalPortions ?? input.portionsYielded ?? null;
    const prepTimeMin = input.prepTimeMinutes ?? input.prepTimeMin ?? null;
    const cookTimeMin = input.cookTimeMinutes ?? input.cookTimeMin ?? null;
    const salePriceCents = input.actualSellPriceCents ?? input.salePriceCents ?? null;
    const instructionsMd = input.procedure ?? input.instructionsMd ?? null;

    const recipe = await prisma.recipe.create({
      data: {
        workspaceId: ctx.workspaceId,
        createdById: ctx.userId,
        name: input.name.trim(),
        authorName: input.authorName ?? null,
        category: input.category ?? null,
        status: input.status ?? "ACTIVE",
        prepTimeMin,
        cookTimeMin,
        portionsYielded,
        portionWeightG: input.portionWeightG ?? null,
        portionVolumeMl: input.portionVolumeMl ?? null,
        totalYieldCanonical: input.totalYieldCanonical ?? null,
        totalYieldDimension: input.totalYieldDimension ?? null,
        salePriceCents,
        goalFoodCostPct: input.goalFoodCostPct ?? null,
        targetMarginPct: input.targetMarginPct ?? null,
        paperCostCents: input.paperCostCents ?? null,
        autoReprice: input.autoReprice ?? true,
        photoUrl: input.photoUrl ?? null,
        prepPhotoUrl: input.prepPhotoUrl ?? null,
        finalPhotoUrl: input.finalPhotoUrl ?? null,
        videoUrl: input.videoUrl ?? null,
        instructionsMd,
        notes: input.notes ?? (input.description ?? null),
        ingredients: lines.length
          ? {
              create: lines.map((line, idx) => ({
                workspaceId: ctx.workspaceId,
                ingredientId: line.ingredientId,
                externalCode: line.externalCode ?? null,
                quantity: line.quantity,
                unit: line.unit,
                yieldPctOverride: line.percentUtilized ?? line.yieldPctOverride ?? null,
                weightOz: line.weightOz ?? null,
                notes: line.notes ?? null,
                displayOrder: idx,
              })),
            }
          : undefined,
      },
    });

    await writeAudit(ctx, {
      action: "recipe.created",
      entityType: "Recipe",
      entityId: recipe.id,
      metadata: { name: recipe.name, ingredientCount: input.ingredients?.length ?? 0 },
    });

    // Trigger initial cost compute
    if (lines.length) {
      await this.recost(ctx, recipe.id, "recipe_edit");
    }

    return recipe;
  }

  async list(
    ctx: TenantContext,
    opts: { search?: string; category?: string; status?: string; cursor?: string; limit?: number },
  ) {
    const limit = Math.min(opts.limit ?? 50, 500);
    const where: any = { workspaceId: ctx.workspaceId, deletedAt: null };
    if (opts.status) where.status = opts.status;
    if (opts.category) where.category = opts.category;
    if (opts.search) where.name = { contains: opts.search, mode: "insensitive" };

    // Single query — ingredient includes are necessary for live cost computation.
    // This avoids N+1 while keeping the total query count at 1.
    const items = await prisma.recipe.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { name: "asc" },
      include: {
        _count: { select: { ingredients: true } },
        ingredients: {
          select: {
            id: true, quantity: true, unit: true, yieldPctOverride: true,
            ingredient: {
              select: {
                id: true, name: true, dimension: true, canonicalUnit: true,
                densityGPerMl: true, currentCostMicrocents: true, defaultYieldPct: true,
              },
            },
          },
        },
      },
    });
    const hasNext = items.length > limit;
    return {
      items: (hasNext ? items.slice(0, limit) : items).map(this.toListDTO),
      nextCursor: hasNext ? items[limit - 1]?.id ?? null : null,
    };
  }

  async get(ctx: TenantContext, id: string): Promise<any> {
    const r = await prisma.recipe.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        ingredients: {
          orderBy: { displayOrder: "asc" },
          include: {
            ingredient: {
              select: {
                id: true, name: true, category: true,
                dimension: true, canonicalUnit: true, densityGPerMl: true,
                currentCostMicrocents: true, defaultYieldPct: true,
                preferredDisplayUnit: true,
              },
            },
          },
        },
        costHistory: { take: 10, orderBy: { computedAt: "desc" } },
      },
    });
    if (!r) throw new NotFoundException({ code: "not_found", message: "Recipe not found" });

    // Compute live cost from current ingredient prices (source of truth)
    const live = computeLiveRecipeCost(r);
    return {
      ...r,
      ingredients: r.ingredients.map(row => ({
        ...row,
        percentUtilized: row.yieldPctOverride != null ? Number(row.yieldPctOverride) : null,
        prepNote: row.prepNote ?? row.notes ?? null,
      })),
      liveCostCents: live.totalCostCents,
      livePerPortionCostCents: live.perPortionCostCents,
      liveFoodCostPct: live.foodCostPct,
      liveMarginPct: live.marginPct,
      liveStaleness: live.staleness,
      liveBreakdown: live.breakdown,
      // Keep cached values for comparison / staleness display
      cachedCostCents: r.cachedCostMicrocents != null ? Number(r.cachedCostMicrocents) / 1000 : null,
      cachedCostUpdatedAt: r.cachedCostUpdatedAt,
    };
  }

  async update(ctx: TenantContext, id: string, input: UpdateRecipeInput) {
    const existing = await prisma.recipe.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Recipe not found" });

    const salePriceCents = input.actualSellPriceCents !== undefined ? input.actualSellPriceCents : input.salePriceCents;
    const portionsYielded = input.totalPortions ?? input.portionsYielded;
    const prepTimeMin = input.prepTimeMinutes ?? input.prepTimeMin;
    const cookTimeMin = input.cookTimeMinutes ?? input.cookTimeMin;
    // Use !== undefined so null passes through (clears the field)
    const instructionsMd = input.procedure !== undefined ? input.procedure : input.instructionsMd;

    const updated = await prisma.recipe.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.authorName !== undefined ? { authorName: input.authorName } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(prepTimeMin !== undefined ? { prepTimeMin } : {}),
        ...(cookTimeMin !== undefined ? { cookTimeMin } : {}),
        ...(portionsYielded !== undefined ? { portionsYielded } : {}),
        ...(input.portionWeightG !== undefined ? { portionWeightG: input.portionWeightG } : {}),
        ...(input.portionVolumeMl !== undefined ? { portionVolumeMl: input.portionVolumeMl } : {}),
        ...(input.totalYieldCanonical !== undefined ? { totalYieldCanonical: input.totalYieldCanonical } : {}),
        ...(input.totalYieldDimension !== undefined ? { totalYieldDimension: input.totalYieldDimension } : {}),
        ...(salePriceCents !== undefined ? { salePriceCents } : {}),
        ...(input.goalFoodCostPct !== undefined ? { goalFoodCostPct: input.goalFoodCostPct } : {}),
        ...(input.targetMarginPct !== undefined ? { targetMarginPct: input.targetMarginPct } : {}),
        ...(input.paperCostCents !== undefined ? { paperCostCents: input.paperCostCents } : {}),
        ...(input.autoReprice !== undefined ? { autoReprice: input.autoReprice } : {}),
        ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
        ...(input.prepPhotoUrl !== undefined ? { prepPhotoUrl: input.prepPhotoUrl } : {}),
        ...(input.finalPhotoUrl !== undefined ? { finalPhotoUrl: input.finalPhotoUrl } : {}),
        ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
        ...(instructionsMd !== undefined ? { instructionsMd } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    await writeAudit(ctx, {
      action: "recipe.updated",
      entityType: "Recipe",
      entityId: id,
      metadata: { changes: Object.keys(input) },
    });

    // Sale price change → recompute margin even though cost unchanged
    if (salePriceCents !== undefined || portionsYielded !== undefined) {
      await this.recost(ctx, id, "recipe_edit");
    }
    return updated;
  }

  async delete(ctx: TenantContext, id: string) {
    const existing = await prisma.recipe.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Recipe not found" });

    await prisma.recipe.update({ where: { id }, data: { deletedAt: new Date() } });

    await writeAudit(ctx, {
      action: "recipe.deleted",
      entityType: "Recipe",
      entityId: id,
      metadata: { name: existing.name },
    });
  }

  // -----------------------------------------------------------------
  // Ingredient line management
  // -----------------------------------------------------------------

  async addIngredient(ctx: TenantContext, recipeId: string, line: RecipeIngredientLineInput) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!recipe) throw new NotFoundException({ code: "not_found", message: "Recipe not found" });

    const ingredient = await prisma.ingredient.findFirst({
      where: { id: line.ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!ingredient) throw new BadRequestException({ code: "validation_failed", message: "Ingredient not found in this workspace" });

    const maxOrder = await prisma.recipeIngredient.aggregate({
      where: { recipeId },
      _max: { displayOrder: true },
    });

    const created = await prisma.recipeIngredient.create({
      data: {
        workspaceId: ctx.workspaceId,
        recipeId,
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        unit: line.unit,
        yieldPctOverride: line.yieldPctOverride ?? null,
        notes: line.notes ?? null,
        displayOrder: (maxOrder._max.displayOrder ?? -1) + 1,
      },
    });

    await this.recost(ctx, recipeId, "recipe_edit");
    return created;
  }

  async removeIngredient(ctx: TenantContext, recipeId: string, recipeIngredientId: string) {
    const link = await prisma.recipeIngredient.findFirst({
      where: { id: recipeIngredientId, recipeId, workspaceId: ctx.workspaceId },
    });
    if (!link) throw new NotFoundException({ code: "not_found", message: "Recipe ingredient not found" });

    await prisma.recipeIngredient.delete({ where: { id: recipeIngredientId } });
    await this.recost(ctx, recipeId, "recipe_edit");
    return { removed: true };
  }

  // -----------------------------------------------------------------
  // Recost â€” the core engine
  // -----------------------------------------------------------------

  async recost(
    ctx: TenantContext | { workspaceId: string; userId: null }, // worker passes null userId
    recipeId: string,
    triggerKind: "ingredient_change" | "manual_recost" | "recipe_edit" | "invoice_confirmed",
    triggerRef?: string,
  ): Promise<RecipeCostBreakdown> {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        ingredients: {
          include: {
            ingredient: {
              select: {
                id: true, name: true,
                dimension: true, canonicalUnit: true, densityGPerMl: true,
                currentCostMicrocents: true, defaultYieldPct: true,
              },
            },
          },
        },
      },
    });
    if (!recipe) throw new NotFoundException({ code: "not_found", message: "Recipe not found" });

    // ---- Compute ----
    const breakdown = this.computeBreakdown(recipe);

    // ---- Persist ----
    // If autoReprice is ON and recipe has a target margin, recalculate sell price.
    // newSellPrice = newCostPerPortion / (1 - targetMarginPct/100)
    const recipeAny = recipe as any;
    let recalcSalePriceCents: number | undefined;
    if (
      breakdown.staleness === "FRESH" &&
      recipeAny.autoReprice !== false &&
      recipeAny.targetMarginPct != null &&
      recipe.portionsYielded &&
      recipe.portionsYielded > 0
    ) {
      const targetMargin = Number(recipeAny.targetMarginPct) / 100;
      if (targetMargin < 1) {
        const newCostCents = Number(breakdown.totalMicrocents) / 1000;
        const perPortionCost = newCostCents / recipe.portionsYielded;
        recalcSalePriceCents = Math.round(perPortionCost / (1 - targetMargin));
      }
    }

    const oldCostMicrocents = recipe.cachedCostMicrocents;
    await prisma.recipe.update({
      where: { id: recipeId },
      data: {
        cachedCostMicrocents: breakdown.staleness === "COMPUTE_ERROR"
          ? null
          : breakdown.totalMicrocents,
        cachedCostUpdatedAt: new Date(),
        costStaleness: breakdown.staleness as any,
        costComputeError: breakdown.computeError,
        cachedMarginPct: breakdown.marginPct != null
          ? new Decimal(breakdown.marginPct.toFixed(2))
          : null,
        ...(recalcSalePriceCents !== undefined ? { salePriceCents: recalcSalePriceCents } : {}),
      },
    });

    // Append history (skip on error to avoid noise)
    if (breakdown.staleness === "FRESH") {
      await prisma.recipeCostHistory.create({
        data: {
          workspaceId: ctx.workspaceId,
          recipeId,
          totalCostMicrocents: breakdown.totalMicrocents,
          portionsYielded: recipe.portionsYielded,
          salePriceCents: recipe.salePriceCents,
          marginPct: breakdown.marginPct != null
            ? new Decimal(breakdown.marginPct.toFixed(2))
            : null,
          triggerKind,
          triggerRef: triggerRef ?? null,
        },
      });
    }

    log.info(
      {
        recipeId, recipeName: recipe.name,
        oldCostCents: oldCostMicrocents != null ? Number(oldCostMicrocents) / 1000 : null,
        newCostCents: Number(breakdown.totalMicrocents) / 1000,
        staleness: breakdown.staleness,
        triggerKind,
        ...(recalcSalePriceCents !== undefined ? { recalcSalePriceCents } : {}),
      },
      "[recipe-recost.worker] picked up job for recipe, old cost → new cost",
    );

    return breakdown;
  }

  /**
   * Pure compute â€” no DB writes. Used by recost() AND by the breakdown
   * endpoint for "show me what the cost WOULD be with these edits".
   */
  computeBreakdown(recipe: any): RecipeCostBreakdown {
    if (recipe.ingredients.length === 0) {
      return {
        totalMicrocents: 0n,
        perPortionMicrocents: null,
        marginPct: null,
        staleness: "NO_INGREDIENTS",
        computeError: null,
        lines: [],
      };
    }

    let totalMicrocents = 0n;
    let anyError = false;
    let firstError: string | null = null;
    const lines: RecipeCostBreakdown["lines"] = [];

    for (const link of recipe.ingredients) {
      const ing = link.ingredient;
      try {
        if (ing.currentCostMicrocents == null) {
          throw new Error(`No price set for "${ing.name}"`);
        }
        const canonicalQty = toCanonical(
          Number(link.quantity),
          link.unit,
          {
            dimension: ing.dimension,
            densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
          },
        );

        // Yield loss: line override > ingredient default. e.g., 95% means
        // 5% trim loss â†’ we need MORE raw to get the cooked quantity,
        // so divide by yieldPct/100.
        const yieldPct = Number(link.yieldPctOverride ?? ing.defaultYieldPct ?? 100);
        const effectiveQty = yieldPct > 0 ? canonicalQty * (100 / yieldPct) : canonicalQty;

        // Cost: canonical-qty Ã— microcents-per-canonical. Round to int.
        const lineMicrocents = BigInt(
          Math.round(effectiveQty * Number(ing.currentCostMicrocents)),
        );
        totalMicrocents += lineMicrocents;

        lines.push({
          recipeIngredientId: link.id,
          ingredientId: ing.id,
          ingredientName: ing.name,
          quantity: Number(link.quantity),
          unit: link.unit,
          canonicalQty: effectiveQty,
          lineCostMicrocents: lineMicrocents,
          error: null,
        });
      } catch (err: any) {
        anyError = true;
        const msg = err instanceof UnitConversionError
          ? `${err.message} (code: ${err.code})`
          : err.message;
        firstError ??= `${ing.name}: ${msg}`;
        lines.push({
          recipeIngredientId: link.id,
          ingredientId: ing.id,
          ingredientName: ing.name,
          quantity: Number(link.quantity),
          unit: link.unit,
          canonicalQty: null,
          lineCostMicrocents: null,
          error: msg,
        });
      }
    }

    if (anyError) {
      return {
        totalMicrocents: 0n,
        perPortionMicrocents: null,
        marginPct: null,
        staleness: "COMPUTE_ERROR",
        computeError: firstError,
        lines,
      };
    }

    const perPortionMicrocents = recipe.portionsYielded && recipe.portionsYielded > 0
      ? totalMicrocents / BigInt(recipe.portionsYielded)
      : null;

    // Margin: (sale - cost) / sale * 100
    let marginPct: number | null = null;
    if (recipe.salePriceCents != null && recipe.salePriceCents > 0) {
      const costCents = Number(totalMicrocents) / 1000;
      const perPortionCost = recipe.portionsYielded ? costCents / recipe.portionsYielded : costCents;
      marginPct = ((recipe.salePriceCents - perPortionCost) / recipe.salePriceCents) * 100;
    }

    return {
      totalMicrocents,
      perPortionMicrocents,
      marginPct,
      staleness: "FRESH",
      computeError: null,
      lines,
    };
  }

  // -----------------------------------------------------------------
  // CSV / Excel import
  // -----------------------------------------------------------------

  /**
   * Parse spreadsheet without saving — returns recipes + per-ingredient match status.
   * Called by POST /recipes/preview-import before the user confirms import.
   */
  async previewImport(
    ctx: TenantContext,
    input: { filename: string; contentBase64: string },
  ) {
    const buf = Buffer.from(input.contentBase64, "base64");
    const parsed = parseXLSX(buf);

    if (parsed.recipes.length === 0) {
      return { recipes: [], unparsed: parsed.unparsed, needsReview: true, overallConfidence: 0 };
    }

    const existingIngredients = await prisma.ingredient.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, name: true },
    });
    const ingByName = new Map(existingIngredients.map(i => [i.name.toLowerCase(), i.id]));

    const recipes = parsed.recipes.map(recipe => ({
      name: recipe.name,
      category: recipe.category ?? null,
      yield_portions: recipe.yield_portions ?? null,
      confidence: recipe.confidence,
      warnings: recipe.warnings,
      ingredients: recipe.ingredients.map(ing => ({
        ingredient_name: ing.ingredient_name,
        quantity: ing.quantity ?? null,
        unit: ing.unit ?? null,
        notes: ing.notes ?? null,
        matchStatus: ingByName.has(ing.ingredient_name.toLowerCase())
          ? ("matched" as const)
          : ("willCreate" as const),
        matchedIngredientId: ingByName.get(ing.ingredient_name.toLowerCase()) ?? null,
      })),
    }));

    const overallConfidence = parsed.recipes.reduce((min, r) => Math.min(min, r.confidence), 1.0);
    return { recipes, unparsed: parsed.unparsed, needsReview: parsed.needsReview, overallConfidence };
  }

  /**
   * Import one or more recipes from a CSV/Excel file.
   *
   * Expected columns (case-insensitive, extra columns ignored):
   *   Recipe Name | Category | Portions Yielded | Ingredient Name | Quantity | Unit | Notes
   *
   * Rows are grouped by "Recipe Name". Ingredients are matched
   * case-insensitively against the workspace ingredient catalog.
   * Unmatched ingredients are created with dimension=MASS (g canonical)
   * so they appear in the catalog for the user to price later.
   */
  async importCsv(
    ctx: TenantContext,
    input: { filename: string; contentBase64: string },
  ) {
    type IngLine = { ingName: string; qty: number; unit: string; notes: string; percentUtilized: number | undefined };
    type RecipeMeta = {
      category: string | null;
      author: string | null;
      portions: number;
      portionWeightOz: number | null;
      portionVolumeFloz: number | null;
      prepTimeMin: number | null;
      cookTimeMin: number | null;
      description: string | null;
      procedure: string | null;
      paperCostCents: number | null;
      lines: IngLine[];
    };

    const buf = Buffer.from(input.contentBase64, "base64");

    // Try deterministic parser first (handles both Format A flat and Format B block layouts).
    const parsed = parseXLSX(buf);
    const recipeMap = new Map<string, RecipeMeta>();

    if (parsed.recipes.length > 0) {
      log.info({ filename: input.filename, recipes: parsed.recipes.length }, "importCsv: deterministic parse succeeded");
      for (const r of parsed.recipes) {
        recipeMap.set(r.name, {
          category: r.category ?? null,
          author: r.author ?? null,
          portions: r.yield_portions ?? 1,
          portionWeightOz: r.portion_weight_oz ?? null,
          portionVolumeFloz: r.portion_volume_floz ?? null,
          prepTimeMin: r.prep_time_minutes ?? null,
          cookTimeMin: r.cook_time_minutes ?? null,
          description: r.description ?? null,
          procedure: r.procedure ?? null,
          paperCostCents: r.paper_cost_cents ?? null,
          lines: r.ingredients.map(ing => ({
            ingName: ing.ingredient_name,
            qty: ing.quantity ?? 0,
            unit: (ing.unit ?? "each").toLowerCase(),
            notes: ing.notes ?? "",
            percentUtilized: ing.utilization_percent,
          })).filter(l => l.ingName && l.qty > 0),
        });
      }
    } else {
      // Fallback: legacy column-name based parser (Format A only, no alias support)
      log.warn({ filename: input.filename, unparsed: parsed.unparsed }, "importCsv: deterministic parse found no recipes, falling back to legacy parser");
      let wb: xlsx.WorkBook;
      try {
        wb = xlsx.read(buf, { type: "buffer", cellDates: true });
      } catch (xlsxErr: any) {
        throw new BadRequestException({
          code: "validation_failed",
          message: `Could not parse file: ${xlsxErr?.message ?? "unknown error"}`,
          hint: "Make sure the file is a valid .xlsx, .xls, or .csv and is not password-protected.",
        });
      }
      const sheetName = wb.SheetNames[0];
      const ws = sheetName ? wb.Sheets[sheetName] : undefined;
      if (!ws) throw new BadRequestException({ code: "validation_failed", message: "Spreadsheet is empty" });

      const legacyRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      if (!legacyRows.length) throw new BadRequestException({ code: "validation_failed", message: "No data rows found" });

      const col = (row: Record<string, unknown>, ...names: string[]): string => {
        for (const n of names) {
          const key = Object.keys(row).find((k) => k.trim().toLowerCase() === n.toLowerCase());
          if (key !== undefined) return String(row[key] ?? "").trim();
        }
        return "";
      };
      for (const row of legacyRows) {
        const recipeName = col(row, "recipe name", "recipe", "name");
        if (!recipeName) continue;
        let meta = recipeMap.get(recipeName);
        if (!meta) {
          meta = {
            category: col(row, "category", "type") || null,
            portions: parseInt(col(row, "portions yielded", "portions", "yield"), 10) || 1,
            prepTimeMin: parseInt(col(row, "prep time min", "prep time", "prep"), 10) || null,
            cookTimeMin: parseInt(col(row, "cook time min", "cook time", "cook"), 10) || null,
            paperCostCents: null,
            lines: [],
          };
          recipeMap.set(recipeName, meta);
        }
        const ingName = col(row, "ingredient name", "ingredient", "item");
        const qty = parseFloat(col(row, "quantity", "qty", "amount")) || 0;
        const unit = (col(row, "unit", "uom") || "each").toLowerCase();
        const notes = col(row, "notes", "note") || "";
        if (ingName && qty > 0) meta.lines.push({ ingName, qty, unit, notes });
      }
    }

    if (!recipeMap.size) throw new BadRequestException({ code: "validation_failed", message: "No valid recipe rows found (check that Recipe Name and Ingredient Name columns exist)" });

    // Load existing workspace ingredients for matching
    const existingIngredients = await prisma.ingredient.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, name: true },
    });
    const ingByName = new Map<string, string>(existingIngredients.map((i) => [i.name.toLowerCase(), i.id]));

    const importedRecipeIds: string[] = [];
    let newIngredientCount = 0;

    for (const [recipeName, meta] of recipeMap) {
      const resolvedLines: Array<{ ingredientId: string; quantity: number; unit: string; notes?: string; displayOrder: number }> = [];
      for (let i = 0; i < meta.lines.length; i++) {
        const line = meta.lines[i];
        if (!line) continue;
        const { ingName, qty, unit, notes } = line;
        let ingredientId = ingByName.get(ingName.toLowerCase());
        if (!ingredientId) {
          const created = await prisma.ingredient.create({
            data: {
              workspaceId: ctx.workspaceId,
              createdById: ctx.userId,
              name: ingName,
              dimension: "MASS",
              canonicalUnit: "g",
              preferredDisplayUnit: unit,
            },
          });
          ingredientId = created.id;
          ingByName.set(ingName.toLowerCase(), ingredientId);
          newIngredientCount++;
        }
        resolvedLines.push({ ingredientId, quantity: qty, unit, notes: notes || undefined, prepNote: notes || undefined, yieldPctOverride: line.percentUtilized ?? undefined, displayOrder: i });
      }

      // Guard against RecipeIngredient.@@unique([recipeId, ingredientId]) P2002:
      // if the XLSX has duplicate ingredient rows for the same recipe they resolve
      // to the same ingredientId via ingByName — keep first occurrence only.
      const seenIds = new Set<string>();
      const uniqueLines = resolvedLines.filter(l => {
        if (seenIds.has(l.ingredientId)) return false;
        seenIds.add(l.ingredientId);
        return true;
      });

      const portionWeightG = meta.portionWeightOz ? meta.portionWeightOz * 28.3495 : null;
      const portionVolumeMl = meta.portionVolumeFloz ? meta.portionVolumeFloz * 29.5735 : null;
      const recipe = await prisma.recipe.create({
        data: {
          workspaceId: ctx.workspaceId,
          createdById: ctx.userId,
          name: recipeName,
          category: meta.category,
          authorName: meta.author ?? null,
          portionsYielded: meta.portions,
          portionWeightG,
          portionVolumeMl,
          prepTimeMin: meta.prepTimeMin,
          cookTimeMin: meta.cookTimeMin,
          notes: meta.description ?? null,
          instructionsMd: meta.procedure ?? null,
          paperCostCents: meta.paperCostCents,
          status: "DRAFT",
          ingredients: uniqueLines.length
            ? { create: uniqueLines.map((l) => ({ workspaceId: ctx.workspaceId, ...l })) }
            : undefined,
        },
      });

      if (uniqueLines.length) {
        await this.recost(ctx, recipe.id, "recipe_edit").catch(() => null);
      }
      importedRecipeIds.push(recipe.id);
    }

    await writeAudit(ctx, {
      action: "recipe.csv_imported",
      entityType: "Recipe",
      entityId: importedRecipeIds[0] ?? "",
      metadata: { recipeCount: importedRecipeIds.length, newIngredientCount, filename: input.filename },
    });

    return { recipeIds: importedRecipeIds, recipeCount: importedRecipeIds.length, newIngredientCount };
  }

  /**
   * Bulk recost: find every recipe in a workspace that uses the given
   * ingredient and recompute. Called by the recost worker.
   */
  async recostAllUsingIngredient(
    workspaceId: string,
    ingredientId: string,
    triggerRef?: string,
    ingredientMeta?: { name: string; oldPriceCents: number | null; newPriceCents: number | null },
  ) {
    const recipes = await prisma.recipe.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ingredients: { some: { ingredientId } },
      },
      select: { id: true, name: true, cachedCostMicrocents: true },
    });
    log.info(
      { workspaceId, ingredientId, recipeCount: recipes.length, triggerRef },
      "[recipe-recost.worker] bulk recost triggered",
    );

    let ok = 0, errors = 0;
    const affected: Array<{ recipeId: string; recipeName: string; oldCostCents: number | null; newCostCents: number | null }> = [];

    for (const r of recipes) {
      try {
        const breakdown = await this.recost(
          { workspaceId, userId: null as any },
          r.id,
          "ingredient_change",
          triggerRef,
        );
        const newCostCents = breakdown.staleness === "FRESH"
          ? Number(breakdown.totalMicrocents) / 1000
          : null;
        affected.push({
          recipeId: r.id,
          recipeName: r.name,
          oldCostCents: r.cachedCostMicrocents != null ? Number(r.cachedCostMicrocents) / 1000 : null,
          newCostCents,
        });
        ok++;
      } catch (err: any) {
        errors++;
        log.error({ recipeId: r.id, err: err.message }, "[recipe-recost.worker] recost failed");
      }
    }

    // Audit log — one entry per ingredient change summarising affected recipes
    if (ok > 0) {
      await prisma.auditLog.create({
        data: {
          workspaceId,
          actorId: null,
          action: "recipe.bulk_recosted",
          entityType: "Ingredient",
          entityId: ingredientId,
          metadata: { triggerRef: triggerRef ?? null, recipesAffected: ok, errors, affected },
        },
      }).catch((err: any) => log.warn({ err: err.message }, "audit log failed"));
    }

    return {
      recosted: ok,
      errors,
      total: recipes.length,
      affected,
      ingredientMeta: ingredientMeta ?? null,
    };
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  private toListDTO = (r: any) => {
    // Compute live cost from included ingredient relations
    const live = computeLiveRecipeCost(r);
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      status: r.status,
      portionsYielded: r.portionsYielded,
      salePriceCents: r.salePriceCents,
      // Live cost — always reflects current ingredient prices (source of truth)
      liveCostCents: live.totalCostCents,
      livePerPortionCostCents: live.perPortionCostCents,
      liveFoodCostPct: live.foodCostPct,
      liveMarginPct: live.marginPct,
      liveStaleness: live.staleness,
      // Cached cost — backup value, may lag by up to the recost debounce window
      cachedCostCents: r.cachedCostMicrocents != null ? Number(r.cachedCostMicrocents) / 1000 : null,
      cachedMarginPct: r.cachedMarginPct != null ? Number(r.cachedMarginPct) : null,
      cachedCostUpdatedAt: r.cachedCostUpdatedAt,
      costStaleness: r.costStaleness,
      ingredientCount: r._count?.ingredients ?? 0,
      autoReprice: r.autoReprice,
      photoUrl: r.photoUrl,
      updatedAt: r.updatedAt,
    };
  };
}
