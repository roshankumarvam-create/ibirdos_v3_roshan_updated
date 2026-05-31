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
// Decimal is reached via the Prisma namespace (avoids the
// "@prisma/client/runtime/library" subpath, which some bundler
// configurations fail to resolve under exports-map restrictions).
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
  paperCostCents?: number;
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
        status: input.status ?? "DRAFT",
        prepTimeMin,
        cookTimeMin,
        portionsYielded,
        portionWeightG: input.portionWeightG ?? null,
        portionVolumeMl: input.portionVolumeMl ?? null,
        totalYieldCanonical: input.totalYieldCanonical ?? null,
        totalYieldDimension: input.totalYieldDimension ?? null,
        salePriceCents,
        goalFoodCostPct: input.goalFoodCostPct ?? null,
        paperCostCents: input.paperCostCents ?? null,
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
    const limit = Math.min(opts.limit ?? 50, 100);
    const where: any = { workspaceId: ctx.workspaceId, deletedAt: null };
    if (opts.status) where.status = opts.status;
    if (opts.category) where.category = opts.category;
    if (opts.search) where.name = { contains: opts.search, mode: "insensitive" };

    const items = await prisma.recipe.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { name: "asc" },
      include: { _count: { select: { ingredients: true } } },
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
    return r;
  }

  async update(ctx: TenantContext, id: string, input: UpdateRecipeInput) {
    const existing = await prisma.recipe.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Recipe not found" });

    const salePriceCents = input.actualSellPriceCents ?? input.salePriceCents;
    const portionsYielded = input.totalPortions ?? input.portionsYielded;
    const prepTimeMin = input.prepTimeMinutes ?? input.prepTimeMin;
    const cookTimeMin = input.cookTimeMinutes ?? input.cookTimeMin;
    const instructionsMd = input.procedure ?? input.instructionsMd;

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
        ...(input.paperCostCents !== undefined ? { paperCostCents: input.paperCostCents } : {}),
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
        totalCents: Number(breakdown.totalMicrocents) / 1000,
        staleness: breakdown.staleness,
        triggerKind,
      },
      "recipe recosted",
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

  /**
   * Bulk recost: find every recipe in a workspace that uses the given
   * ingredient and recompute. Called by the recost worker.
   */
  async recostAllUsingIngredient(workspaceId: string, ingredientId: string, triggerRef?: string) {
    const recipes = await prisma.recipe.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ingredients: { some: { ingredientId } },
      },
      select: { id: true },
    });
    log.info({ workspaceId, ingredientId, recipeCount: recipes.length }, "bulk recost triggered");

    let ok = 0, errors = 0;
    for (const r of recipes) {
      try {
        await this.recost(
          { workspaceId, userId: null as any },
          r.id,
          "ingredient_change",
          triggerRef,
        );
        ok++;
      } catch (err: any) {
        errors++;
        log.error({ recipeId: r.id, err: err.message }, "recost failed");
      }
    }
    return { recosted: ok, errors, total: recipes.length };
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  private toListDTO = (r: any) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    status: r.status,
    portionsYielded: r.portionsYielded,
    salePriceCents: r.salePriceCents,
    cachedCostCents: r.cachedCostMicrocents != null
      ? Number(r.cachedCostMicrocents) / 1000
      : null,
    cachedMarginPct: r.cachedMarginPct != null ? Number(r.cachedMarginPct) : null,
    costStaleness: r.costStaleness,
    ingredientCount: r._count?.ingredients ?? 0,
    photoUrl: r.photoUrl,
    updatedAt: r.updatedAt,
  });
}
