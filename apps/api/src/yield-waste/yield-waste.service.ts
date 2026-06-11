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

  /** Per-ingredient trim yield rates (avg, min, max over the window). */
  async getTrimYieldRate(ctx: TenantContext, opts: { sinceDays?: number; ingredientId?: string }) {
    const { workspaceId } = ctx;
    const where: any = { workspaceId };
    if (opts.ingredientId) where.ingredientId = opts.ingredientId;
    if (opts.sinceDays) where.observedAt = { gte: new Date(Date.now() - opts.sinceDays * 86400_000) };

    const entries = await prisma.yieldEntry.findMany({
      where,
      select: { ingredientId: true, yieldPct: true, ingredient: { select: { name: true, defaultYieldPct: true } } },
    });

    const grouped = new Map<string, { name: string; defaultYieldPct: number; values: number[] }>();
    for (const e of entries) {
      const existing = grouped.get(e.ingredientId) ?? {
        name: e.ingredient.name,
        defaultYieldPct: Number(e.ingredient.defaultYieldPct),
        values: [],
      };
      existing.values.push(Number(e.yieldPct));
      grouped.set(e.ingredientId, existing);
    }

    return Array.from(grouped.entries()).map(([ingredientId, g]) => {
      const avg = g.values.reduce((s, v) => s + v, 0) / g.values.length;
      return {
        ingredientId,
        ingredientName: g.name,
        defaultYieldPct: parseFloat(g.defaultYieldPct.toFixed(2)),
        avgYieldPct: parseFloat(avg.toFixed(2)),
        minYieldPct: parseFloat(Math.min(...g.values).toFixed(2)),
        maxYieldPct: parseFloat(Math.max(...g.values).toFixed(2)),
        observations: g.values.length,
      };
    }).sort((a, b) => a.avgYieldPct - b.avgYieldPct);
  }

  /** Waste by reason with cost totals vs a target threshold. */
  async getWasteTargetReport(ctx: TenantContext, opts: { sinceDays?: number; targetCostCents?: number }) {
    const { workspaceId } = ctx;
    const since = opts.sinceDays
      ? new Date(Date.now() - opts.sinceDays * 86400_000)
      : new Date(Date.now() - 30 * 86400_000);

    const entries = await prisma.wasteEntry.findMany({
      where: { workspaceId, occurredAt: { gte: since } },
      select: { reason: true, costMicrocents: true, quantityCanonical: true },
    });

    const byReason = new Map<string, { costMicrocents: bigint; count: number; qtyCanonical: number }>();
    for (const e of entries) {
      const existing = byReason.get(e.reason) ?? { costMicrocents: 0n, count: 0, qtyCanonical: 0 };
      existing.costMicrocents += e.costMicrocents;
      existing.count++;
      existing.qtyCanonical += Number(e.quantityCanonical);
      byReason.set(e.reason, existing);
    }

    const totalCostCents = Array.from(byReason.values()).reduce((s, v) => s + Number(v.costMicrocents) / 1000, 0);
    const targetCostCents = opts.targetCostCents ?? null;

    return {
      totalCostCents: parseFloat(totalCostCents.toFixed(2)),
      targetCostCents,
      overTarget: targetCostCents != null ? totalCostCents > targetCostCents : null,
      byReason: Array.from(byReason.entries()).map(([reason, v]) => ({
        reason,
        count: v.count,
        costCents: parseFloat((Number(v.costMicrocents) / 1000).toFixed(2)),
        qtyCanonical: parseFloat(v.qtyCanonical.toFixed(3)),
      })).sort((a, b) => b.costCents - a.costCents),
    };
  }

  /** Waste cost attributed to specific events. */
  async getEventWasteImpact(ctx: TenantContext, opts: { eventId?: string; sinceDays?: number }) {
    const { workspaceId } = ctx;
    const where: any = { workspaceId, eventId: { not: null } };
    if (opts.eventId) where.eventId = opts.eventId;
    if (opts.sinceDays) where.occurredAt = { gte: new Date(Date.now() - opts.sinceDays * 86400_000) };

    const entries = await prisma.wasteEntry.findMany({
      where,
      select: { eventId: true, costMicrocents: true },
    });

    const byEvent = new Map<string, { costMicrocents: bigint; count: number }>();
    for (const e of entries) {
      if (!e.eventId) continue;
      const existing = byEvent.get(e.eventId) ?? { costMicrocents: 0n, count: 0 };
      existing.costMicrocents += e.costMicrocents;
      existing.count++;
      byEvent.set(e.eventId, existing);
    }

    if (byEvent.size === 0) return [];

    const eventIds = Array.from(byEvent.keys());
    const events = await prisma.event.findMany({
      where: { workspaceId, id: { in: eventIds } },
      select: { id: true, name: true, startsAt: true },
    });
    const eventMap = new Map(events.map((e) => [e.id, e]));

    return Array.from(byEvent.entries()).map(([eventId, v]) => {
      const ev = eventMap.get(eventId);
      return {
        eventId,
        eventName: ev?.name ?? "Unknown event",
        startsAt: ev?.startsAt ?? null,
        costCents: parseFloat((Number(v.costMicrocents) / 1000).toFixed(2)),
        wasteCount: v.count,
      };
    }).sort((a, b) => b.costCents - a.costCents);
  }
}
