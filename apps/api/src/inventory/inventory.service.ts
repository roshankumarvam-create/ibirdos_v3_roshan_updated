import { Injectable, BadRequestException, NotFoundException, Inject } from "@nestjs/common";
// Decimal is reached via the Prisma namespace (avoids the
// "@prisma/client/runtime/library" subpath, which some bundler
// configurations fail to resolve under exports-map restrictions).
import { Prisma } from "@prisma/client";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { toCanonical } from "@ibirdos/types";

import { REDIS_CLIENT } from "../app.module";

const log = moduleLogger("InventoryService");

interface RecordTxParams {
  ingredientId: string;
  kind: "RECEIVE" | "CONSUME" | "ADJUST" | "TRANSFER_OUT" | "TRANSFER_IN" | "WASTE";
  quantityCanonical: number;   // signed: positive = IN, negative = OUT
  costMicrocents?: bigint | null;
  sourceKind: string;          // "Invoice" | "Recipe" | "Event" | "Manual"
  sourceRef?: string;
  notes?: string;
}

@Injectable()
export class InventoryService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * The ONE way stock changes. Atomic: tx + balance update in single
   * Prisma transaction; emits low-stock alert if threshold crossed.
   */
  async recordTransaction(ctx: TenantContext, params: RecordTxParams) {
    if (params.quantityCanonical === 0) {
      throw new BadRequestException({ code: "validation_failed", message: "Zero-quantity transaction not allowed" });
    }

    const ing = await prisma.ingredient.findFirst({
      where: { id: params.ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    const current = new Decimal(ing.currentStockCanonical);
    const delta = new Decimal(params.quantityCanonical);
    const newBalance = current.plus(delta);

    if (newBalance.lt(0)) {
      throw new BadRequestException({
        code: "validation_failed",
        message: `Would result in negative stock (${current.toString()} + ${delta.toString()} = ${newBalance.toString()})`,
      });
    }

    const [tx, updated] = await prisma.$transaction([
      prisma.inventoryTransaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          ingredientId: params.ingredientId,
          kind: params.kind,
          quantityCanonical: delta,
          balanceAfterCanonical: newBalance,
          costMicrocents: params.costMicrocents ?? null,
          sourceKind: params.sourceKind,
          sourceRef: params.sourceRef ?? null,
          notes: params.notes ?? null,
          createdById: ctx.userId,
        },
      }),
      prisma.ingredient.update({
        where: { id: params.ingredientId },
        data: { currentStockCanonical: newBalance },
      }),
    ]);

    await writeAudit(ctx, {
      action: `inventory.${params.kind.toLowerCase()}`,
      entityType: "Ingredient",
      entityId: params.ingredientId,
      metadata: { delta: delta.toString(), balanceAfter: newBalance.toString(), source: params.sourceKind, sourceRef: params.sourceRef },
    });

    // Low-stock check
    await this.checkLowStock(ctx, params.ingredientId, updated.currentStockCanonical, updated.reorderThresholdCanonical);

    log.info({ ingredientId: params.ingredientId, kind: params.kind, delta: delta.toString(), balanceAfter: newBalance.toString() }, "inventory tx recorded");
    return tx;
  }

  async checkLowStock(ctx: TenantContext, ingredientId: string, current: Decimal, threshold: Decimal | null) {
    if (!threshold || current.gte(threshold)) {
      // If stock is back above threshold, resolve any open alert
      await prisma.lowStockAlert.updateMany({
        where: { workspaceId: ctx.workspaceId, ingredientId, status: "OPEN" },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      return;
    }
    // Upsert open alert (unique on workspaceId+ingredientId+status)
    await prisma.lowStockAlert.upsert({
      where: { workspaceId_ingredientId_status: { workspaceId: ctx.workspaceId, ingredientId, status: "OPEN" } },
      create: {
        workspaceId: ctx.workspaceId, ingredientId,
        currentCanonical: current, thresholdCanonical: threshold,
      },
      update: { currentCanonical: current },
    }).catch(() => {/* race ok */});

    await this.redis.publish("inventory.low_stock", JSON.stringify({
      workspaceId: ctx.workspaceId, ingredientId,
      current: current.toString(), threshold: threshold.toString(),
      at: new Date().toISOString(),
    })).catch(() => {});
  }

  async listTransactions(ctx: TenantContext, opts: { ingredientId?: string; kind?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(opts.limit ?? 100, 200);
    const where: any = { workspaceId: ctx.workspaceId };
    if (opts.ingredientId) where.ingredientId = opts.ingredientId;
    if (opts.kind) where.kind = opts.kind;
    const items = await prisma.inventoryTransaction.findMany({
      where, take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { createdAt: "desc" },
      include: { ingredient: { select: { id: true, name: true, canonicalUnit: true } } },
    });
    return {
      items: (items.length > limit ? items.slice(0, limit) : items).map((t) => ({
        ...t,
        quantityCanonical: Number(t.quantityCanonical),
        balanceAfterCanonical: Number(t.balanceAfterCanonical),
        costMicrocents: t.costMicrocents?.toString() ?? null,
      })),
      nextCursor: items.length > limit ? items[limit - 1]?.id ?? null : null,
    };
  }

  async listLowStockAlerts(ctx: TenantContext, status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" = "OPEN") {
    return prisma.lowStockAlert.findMany({
      where: { workspaceId: ctx.workspaceId, status },
      include: { ingredient: { select: { id: true, name: true, canonicalUnit: true, preferredDisplayUnit: true } } },
      orderBy: { detectedAt: "desc" },
    });
  }

  /** Manual adjustment helper — wraps recordTransaction with friendlier inputs. */
  async adjust(ctx: TenantContext, ingredientId: string, params: { quantity: number; unit: string; reason: string }) {
    const ing = await prisma.ingredient.findFirst({
      where: { id: ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    const canonicalQty = toCanonical(Math.abs(params.quantity), params.unit, {
      dimension: ing.dimension,
      densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
    });
    const signed = params.quantity < 0 ? -canonicalQty : canonicalQty;

    return this.recordTransaction(ctx, {
      ingredientId, kind: "ADJUST",
      quantityCanonical: signed,
      sourceKind: "Manual",
      notes: params.reason,
    });
  }
}
