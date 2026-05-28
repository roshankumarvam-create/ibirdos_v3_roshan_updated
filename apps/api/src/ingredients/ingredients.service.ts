// =====================================================================
// apps/api/src/ingredients/ingredients.service.ts
// =====================================================================
// The core domain service. Every cost in the platform flows through
// the operations here:
//
//   - create / update ingredient (catalog management)
//   - update price (writes history, emits ingredient.cost_changed
//     event — Phase 7 subscribes to recost recipes)
//   - match text → ingredient (used by Phase 6 invoice review UI)
//
// Cost is stored in MICRO-CENTS per canonical unit (g/ml/each) so
// fractional spice quantities don't round to zero.
// =====================================================================

import {
  Injectable, NotFoundException, BadRequestException, Inject,
} from "@nestjs/common";

import {
  prisma, tenantScoped, writeAudit, type TenantContext,
} from "@ibirdos/db";
import {
  CANONICAL_UNIT, UNITS, normalizeUnit, type UnitDimension,
  type CreateIngredientInput, type UpdateIngredientInput,
  type IngredientDTO, type IngredientMatchResult, type MatchIngredientInput,
} from "@ibirdos/types";
import { moduleLogger } from "@ibirdos/logger";
import { Redis } from "ioredis";

import { REDIS_CLIENT } from "../app.module";

const log = moduleLogger("IngredientsService");

const MICROCENTS_PER_CENT = 1000n;

@Injectable()
export class IngredientsService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // -----------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------

  async create(ctx: TenantContext, input: CreateIngredientInput): Promise<IngredientDTO> {
    this.validateUnit(input.canonicalUnit, input.dimension);

    if (input.densityGPerMl == null && input.dimension === "MASS") {
      // density is optional but warning-worthy for ingredients commonly
      // measured in volume in recipes. Recorded but allowed.
    }

    const ing = await prisma.ingredient.create({
      data: {
        workspaceId: ctx.workspaceId,
        createdById: ctx.userId,
        name: input.name.trim(),
        category: input.category,
        dimension: input.dimension,
        canonicalUnit: input.canonicalUnit,
        densityGPerMl: input.densityGPerMl ?? null,
        preferredDisplayUnit: input.preferredDisplayUnit ?? null,
        reorderThresholdCanonical: input.reorderThresholdCanonical ?? null,
        defaultYieldPct: input.defaultYieldPct ?? 100,
        currentVendorId: input.vendorId ?? null,
        notes: input.notes ?? null,
        currentCostMicrocents:
          input.initialCostPerCanonicalCents != null
            ? BigInt(Math.round(input.initialCostPerCanonicalCents)) * MICROCENTS_PER_CENT
            : null,
      },
    });

    if (input.initialCostPerCanonicalCents != null) {
      await prisma.ingredientPriceHistory.create({
        data: {
          workspaceId: ctx.workspaceId,
          ingredientId: ing.id,
          vendorId: input.vendorId ?? null,
          pricePerCanonicalMicrocents:
            BigInt(Math.round(input.initialCostPerCanonicalCents)) * MICROCENTS_PER_CENT,
          source: "MANUAL",
          createdById: ctx.userId,
        },
      });
    }

    // Self-alias: the ingredient's name resolves to itself
    await prisma.ingredientAlias.create({
      data: {
        workspaceId: ctx.workspaceId,
        ingredientId: ing.id,
        text: ing.name.toLowerCase(),
        source: "MANUAL",
        confidence: 1.0,
        createdById: ctx.userId,
      },
    });

    await writeAudit(ctx, {
      action: "ingredient.created",
      entityType: "Ingredient",
      entityId: ing.id,
      metadata: { name: ing.name, category: ing.category },
    });

    return this.toDTO(ing);
  }

  async list(ctx: TenantContext, opts: { search?: string; category?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const repo = tenantScoped(prisma.ingredient, ctx);
    const where: any = {};
    if (opts.category) where.category = opts.category;
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: "insensitive" } },
        { aliases: { some: { text: { contains: opts.search.toLowerCase() } } } },
      ];
    }
    const items = await repo.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { name: "asc" },
      include: {
        _count: { select: { aliases: true } },
        priceHistory: {
          take: 1,
          orderBy: { effectiveAt: "desc" },
          select: { effectiveAt: true },
        },
      },
    });

    const hasNext = items.length > limit;
    const slice = hasNext ? items.slice(0, limit) : items;
    return {
      items: slice.map((i: any) => this.toDTO(i)),
      nextCursor: hasNext ? (slice[slice.length - 1]?.id ?? null) : null,
    };
  }

  async get(ctx: TenantContext, id: string) {
    const ing = await prisma.ingredient.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        vendor: { select: { id: true, name: true } },
        aliases: { orderBy: { createdAt: "desc" } },
        priceHistory: {
          take: 50,
          orderBy: { effectiveAt: "desc" },
          include: { vendor: { select: { name: true } } },
        },
      },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });
    return ing;
  }

  async update(ctx: TenantContext, id: string, input: UpdateIngredientInput) {
    const existing = await prisma.ingredient.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    if (input.canonicalUnit && input.dimension) {
      this.validateUnit(input.canonicalUnit, input.dimension);
    }

    const updated = await prisma.ingredient.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.dimension !== undefined ? { dimension: input.dimension } : {}),
        ...(input.canonicalUnit !== undefined ? { canonicalUnit: input.canonicalUnit } : {}),
        ...(input.densityGPerMl !== undefined ? { densityGPerMl: input.densityGPerMl } : {}),
        ...(input.preferredDisplayUnit !== undefined ? { preferredDisplayUnit: input.preferredDisplayUnit } : {}),
        ...(input.reorderThresholdCanonical !== undefined ? { reorderThresholdCanonical: input.reorderThresholdCanonical } : {}),
        ...(input.defaultYieldPct !== undefined ? { defaultYieldPct: input.defaultYieldPct } : {}),
        ...(input.vendorId !== undefined ? { currentVendorId: input.vendorId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    await writeAudit(ctx, {
      action: "ingredient.updated",
      entityType: "Ingredient",
      entityId: id,
      metadata: { changes: Object.keys(input) },
    });

    return updated;
  }

  // -----------------------------------------------------------------
  // Price updates — emits ingredient.cost_changed event
  // -----------------------------------------------------------------

  async updatePrice(
    ctx: TenantContext,
    ingredientId: string,
    params: {
      pricePerCanonicalCents: number;     // pass the human-readable cents value
      source: "MANUAL" | "INVOICE" | "VENDOR_API" | "IMPORTED";
      sourceRef?: string;
      vendorId?: string;
      notes?: string;
    },
  ) {
    if (params.pricePerCanonicalCents < 0) {
      throw new BadRequestException({ code: "validation_failed", message: "Price must be non-negative" });
    }

    const ing = await prisma.ingredient.findFirst({
      where: { id: ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    const oldMicrocents = ing.currentCostMicrocents;
    const newMicrocents = BigInt(Math.round(params.pricePerCanonicalCents * 1000)); // 1 cent = 1000 microcents

    // Skip no-op writes (price unchanged)
    if (oldMicrocents === newMicrocents) return ing;

    await prisma.$transaction([
      prisma.ingredient.update({
        where: { id: ingredientId },
        data: {
          currentCostMicrocents: newMicrocents,
          ...(params.vendorId ? { currentVendorId: params.vendorId } : {}),
        },
      }),
      prisma.ingredientPriceHistory.create({
        data: {
          workspaceId: ctx.workspaceId,
          ingredientId,
          vendorId: params.vendorId ?? ing.currentVendorId ?? null,
          pricePerCanonicalMicrocents: newMicrocents,
          source: params.source,
          sourceRef: params.sourceRef ?? null,
          notes: params.notes ?? null,
          createdById: ctx.userId,
        },
      }),
    ]);

    await writeAudit(ctx, {
      action: "ingredient.price_changed",
      entityType: "Ingredient",
      entityId: ingredientId,
      metadata: {
        from: oldMicrocents?.toString() ?? null,
        to: newMicrocents.toString(),
        source: params.source,
        sourceRef: params.sourceRef ?? null,
      },
    });

    // Emit event — Phase 7 RecipesService subscribes via BullMQ to
    // recost any recipe using this ingredient.
    await this.redis
      .publish(
        "ingredient.cost_changed",
        JSON.stringify({
          workspaceId: ctx.workspaceId,
          ingredientId,
          fromMicrocents: oldMicrocents?.toString() ?? null,
          toMicrocents: newMicrocents.toString(),
          source: params.source,
          actorId: ctx.userId,
          at: new Date().toISOString(),
        }),
      )
      .catch((err) => log.warn({ err: err.message }, "event publish failed"));

    log.info(
      {
        workspaceId: ctx.workspaceId,
        ingredientId,
        from: oldMicrocents?.toString(),
        to: newMicrocents.toString(),
        source: params.source,
      },
      "ingredient price changed",
    );

    return prisma.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
  }

  // -----------------------------------------------------------------
  // Matching engine — 3-pass: exact → fuzzy → AI (Phase 6)
  // -----------------------------------------------------------------

  async match(ctx: TenantContext, input: MatchIngredientInput): Promise<IngredientMatchResult[]> {
    const normalized = input.text.trim().toLowerCase();
    if (!normalized) return [];

    // ---- Pass 1: exact alias hit ----
    const exact = await prisma.ingredientAlias.findFirst({
      where: { workspaceId: ctx.workspaceId, text: normalized },
      include: { ingredient: { select: { id: true, name: true, deletedAt: true } } },
    });
    if (exact && !exact.ingredient.deletedAt) {
      return [{
        ingredientId: exact.ingredientId,
        ingredientName: exact.ingredient.name,
        matchType: "exact",
        confidence: Number(exact.confidence),
      }];
    }

    // ---- Pass 2: trigram fuzzy match ----
    // Requires pg_trgm extension. Migration 0002 enables it.
    const fuzzy = await prisma.$queryRaw<
      Array<{ id: string; name: string; sim: number }>
    >`
      SELECT i.id, i.name,
             GREATEST(
               similarity(LOWER(i.name), ${normalized}),
               COALESCE((
                 SELECT MAX(similarity(a.text, ${normalized}))
                 FROM ingredient_aliases a
                 WHERE a.ingredient_id = i.id
               ), 0)
             ) AS sim
      FROM ingredients i
      WHERE i.workspace_id = ${ctx.workspaceId}
        AND i.deleted_at IS NULL
        AND (
          LOWER(i.name) % ${normalized}
          OR EXISTS (
            SELECT 1 FROM ingredient_aliases a
            WHERE a.ingredient_id = i.id
              AND a.text % ${normalized}
          )
        )
      ORDER BY sim DESC
      LIMIT 5
    `;

    if (fuzzy.length > 0) {
      return fuzzy.map((row) => ({
        ingredientId: row.id,
        ingredientName: row.name,
        matchType: "fuzzy" as const,
        confidence: Number(row.sim),
      }));
    }

    return [{
      ingredientId: "",
      ingredientName: "",
      matchType: "none",
      confidence: 0,
    }];
  }

  async addAlias(ctx: TenantContext, ingredientId: string, text: string, source: "MANUAL" | "INVOICE" | "RECIPE" | "VENDOR_CATALOG" | "AI_MATCH" = "MANUAL") {
    const normalized = text.trim().toLowerCase();
    if (!normalized) throw new BadRequestException({ code: "validation_failed", message: "Alias text required" });

    // Ingredient must exist in this workspace
    const ing = await prisma.ingredient.findFirst({
      where: { id: ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    return prisma.ingredientAlias.upsert({
      where: { workspaceId_text: { workspaceId: ctx.workspaceId, text: normalized } },
      create: {
        workspaceId: ctx.workspaceId,
        ingredientId, text: normalized, source, confidence: 1.0,
        createdById: ctx.userId,
      },
      update: { ingredientId, source, confidence: 1.0, needsReview: false },
    });
  }

  // -----------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------

  private validateUnit(unit: string, dimension: UnitDimension) {
    const normalized = normalizeUnit(unit);
    if (!normalized) {
      throw new BadRequestException({
        code: "validation_failed",
        message: `Unknown unit "${unit}". Use one of: ${Object.keys(UNITS).join(", ")}`,
      });
    }
    if (UNITS[normalized]!.dimension !== dimension) {
      throw new BadRequestException({
        code: "validation_failed",
        message: `Unit ${unit} is ${UNITS[normalized]!.dimension} but ingredient declared as ${dimension}`,
      });
    }
    // For canonicalUnit specifically, we expect the canonical form
    if (CANONICAL_UNIT[dimension] !== normalized) {
      throw new BadRequestException({
        code: "validation_failed",
        message: `canonicalUnit for ${dimension} must be ${CANONICAL_UNIT[dimension]}, got ${normalized}`,
      });
    }
  }

  private toDTO(ing: any): IngredientDTO {
    return {
      id: ing.id,
      name: ing.name,
      category: ing.category,
      dimension: ing.dimension,
      canonicalUnit: ing.canonicalUnit,
      densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
      currentCostCents:
        ing.currentCostMicrocents != null
          ? Number(ing.currentCostMicrocents) / 1000
          : null,
      currentVendorId: ing.currentVendorId,
      currentStockCanonical: Number(ing.currentStockCanonical ?? 0),
      reorderThresholdCanonical:
        ing.reorderThresholdCanonical != null ? Number(ing.reorderThresholdCanonical) : null,
      preferredDisplayUnit: ing.preferredDisplayUnit,
      defaultYieldPct: Number(ing.defaultYieldPct),
      photoUrl: ing.photoUrl,
      aliasCount: ing._count?.aliases ?? 0,
      lastPriceChangeAt:
        ing.priceHistory?.[0]?.effectiveAt?.toISOString?.() ?? null,
    };
  }
}
