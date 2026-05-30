import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
// Decimal is reached via the Prisma namespace (avoids the
// "@prisma/client/runtime/library" subpath, which some bundler
// configurations fail to resolve under exports-map restrictions).
import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { toCanonical } from "@ibirdos/types";

import { InventoryService } from "../inventory/inventory.service";

const log = moduleLogger("YieldWasteService");

@Injectable()
export class YieldWasteService {
  constructor(private readonly inventory: InventoryService) {}

  /**
   * Record an observed yield. Updates the ingredient's defaultYieldPct
   * using a 10-entry exponentially-weighted moving average so the
   * default tracks recent reality without single-entry whiplash.
   */
  async recordYield(ctx: TenantContext, input: {
    ingredientId: string; rawQuantity: number; rawUnit: string;
    yieldQuantity: number; yieldUnit: string; recipeId?: string; notes?: string;
  }) {
    const ing = await prisma.ingredient.findFirst({
      where: { id: input.ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    const dctx = {
      dimension: ing.dimension,
      densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
    };
    const rawCanonical = toCanonical(input.rawQuantity, input.rawUnit, dctx);
    const yieldCanonical = toCanonical(input.yieldQuantity, input.yieldUnit, dctx);
    if (rawCanonical <= 0) throw new BadRequestException({ code: "validation_failed", message: "Raw must be positive" });
    if (yieldCanonical > rawCanonical) throw new BadRequestException({ code: "validation_failed", message: "Yield cannot exceed raw" });

    const yieldPct = (yieldCanonical / rawCanonical) * 100;

    const entry = await prisma.yieldEntry.create({
      data: {
        workspaceId: ctx.workspaceId, ingredientId: input.ingredientId,
        recipeId: input.recipeId ?? null,
        rawCanonical: new Decimal(rawCanonical.toFixed(4)),
        yieldCanonical: new Decimal(yieldCanonical.toFixed(4)),
        yieldPct: new Decimal(yieldPct.toFixed(2)),
        notes: input.notes ?? null,
        createdById: ctx.userId,
      },
    });

    // Update rolling default — EWMA with alpha=0.2 (smooths outliers)
    const newDefault = Number(ing.defaultYieldPct) * 0.8 + yieldPct * 0.2;
    await prisma.ingredient.update({
      where: { id: input.ingredientId },
      data: { defaultYieldPct: new Decimal(newDefault.toFixed(2)) },
    });

    await writeAudit(ctx, {
      action: "yield.recorded", entityType: "Ingredient", entityId: input.ingredientId,
      metadata: { yieldPct: yieldPct.toFixed(1), recipeId: input.recipeId ?? null, newDefaultYieldPct: newDefault.toFixed(2) },
    });
    log.info({ ingredientId: input.ingredientId, yieldPct, newDefault }, "yield recorded");
    return entry;
  }

  /**
   * Record waste. Writes a WasteEntry + a WASTE inventory transaction
   * (debits stock). Cost snapshotted from current ingredient price.
   */
  async recordWaste(ctx: TenantContext, input: {
    ingredientId: string; quantity: number; unit: string;
    reason: "SPOILAGE" | "OVERPRODUCTION" | "TRIM_LOSS" | "COOKING_ERROR" | "CUSTOMER_RETURN" | "DROPPED" | "EXPIRED" | "OTHER";
    recipeId?: string; eventId?: string; notes?: string;
  }) {
    const ing = await prisma.ingredient.findFirst({
      where: { id: input.ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    const canonicalQty = toCanonical(input.quantity, input.unit, {
      dimension: ing.dimension,
      densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
    });
    const costMicrocents = ing.currentCostMicrocents != null
      ? BigInt(Math.round(canonicalQty * Number(ing.currentCostMicrocents)))
      : 0n;

    const entry = await prisma.wasteEntry.create({
      data: {
        workspaceId: ctx.workspaceId, ingredientId: input.ingredientId,
        reason: input.reason,
        quantityCanonical: new Decimal(canonicalQty.toFixed(4)),
        costMicrocents,
        recipeId: input.recipeId ?? null, eventId: input.eventId ?? null,
        notes: input.notes ?? null, createdById: ctx.userId,
      },
    });

    // Stock debit via inventory ledger
    await this.inventory.recordTransaction(ctx, {
      ingredientId: input.ingredientId, kind: "WASTE",
      quantityCanonical: -canonicalQty, costMicrocents,
      sourceKind: "Waste", sourceRef: entry.id,
      notes: `${input.reason}${input.notes ? ` — ${input.notes}` : ""}`,
    });

    await writeAudit(ctx, {
      action: "waste.recorded", entityType: "Ingredient", entityId: input.ingredientId,
      metadata: { reason: input.reason, costCents: Number(costMicrocents) / 1000, recipeId: input.recipeId, eventId: input.eventId },
    });
    return entry;
  }

  async listYield(ctx: TenantContext, opts: { ingredientId?: string; limit?: number }) {
    const where: any = { workspaceId: ctx.workspaceId };
    if (opts.ingredientId) where.ingredientId = opts.ingredientId;
    return prisma.yieldEntry.findMany({
      where, take: Math.min(opts.limit ?? 100, 200),
      orderBy: { observedAt: "desc" },
      include: { ingredient: { select: { id: true, name: true } } },
    });
  }

  async listWaste(ctx: TenantContext, opts: { ingredientId?: string; reason?: string; limit?: number; sinceDays?: number }) {
    const where: any = { workspaceId: ctx.workspaceId };
    if (opts.ingredientId) where.ingredientId = opts.ingredientId;
    if (opts.reason) where.reason = opts.reason;
    if (opts.sinceDays) where.occurredAt = { gte: new Date(Date.now() - opts.sinceDays * 86400_000) };
    return prisma.wasteEntry.findMany({
      where, take: Math.min(opts.limit ?? 100, 200),
      orderBy: { occurredAt: "desc" },
      include: { ingredient: { select: { id: true, name: true } } },
    });
  }
}
