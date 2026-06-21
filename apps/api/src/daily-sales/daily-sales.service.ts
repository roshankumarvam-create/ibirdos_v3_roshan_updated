import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from "@nestjs/common";
import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("DailySalesService");

export interface CreateDailySalesInput {
  saleDate: string;           // YYYY-MM-DD
  grossSales: number;
  netSales: number;
  tax: number;
  discounts?: number;
  voids?: number;
  refunds?: number;
  cateringSales?: number;
  onlineSales?: number;
  deliveryAppSales?: number;
  notes?: string;
  sourceFileUrl?: string;
  status?: "NO_BUSINESS" | "CLOSED_WON" | "LOST" | "FOLLOW_UP";
  shift?: "BREAKFAST" | "LUNCH" | "DINNER" | "LATE_NIGHT" | "OTHER";
  tenders?: Array<{ tenderType: string; amount: number; count?: number }>;
}

export interface UpdateDailySalesInput {
  grossSales?: number;
  netSales?: number;
  tax?: number;
  discounts?: number;
  voids?: number;
  refunds?: number;
  cateringSales?: number;
  onlineSales?: number;
  deliveryAppSales?: number;
  notes?: string;
  sourceFileUrl?: string;
  status?: "NO_BUSINESS" | "CLOSED_WON" | "LOST" | "FOLLOW_UP";
  shift?: "BREAKFAST" | "LUNCH" | "DINNER" | "LATE_NIGHT" | "OTHER";
  tenders?: Array<{ tenderType: string; amount: number; count?: number }>;
}

@Injectable()
export class DailySalesService {
  async create(ctx: TenantContext, input: CreateDailySalesInput, mode?: "add" | "replace") {
    const saleDate = new Date(input.saleDate);
    if (isNaN(saleDate.getTime())) {
      throw new BadRequestException({ code: "validation_failed", message: "Invalid saleDate" });
    }

    // Check for existing entry on this date
    const existing = await prisma.dailySales.findFirst({
      where: { workspaceId: ctx.workspaceId, saleDate },
      include: { tenders: true },
    });

    if (existing) {
      if (!mode) {
        // No mode — signal the frontend to show the merge/replace modal
        throw new ConflictException({
          code: "duplicate_date",
          message: `Daily sales for ${input.saleDate} already exists`,
          details: { existingId: existing.id, saleDate: input.saleDate },
        });
      }

      if (mode === "add") {
        // Sum numeric fields + merge tenders
        const updated = await prisma.$transaction(async (tx) => {
          // Merge tenders: sum by tenderType
          const mergedTenders = new Map<string, { amount: number; count: number }>();
          for (const t of existing.tenders) {
            mergedTenders.set(t.tenderType, { amount: Number(t.amount), count: t.count ?? 0 });
          }
          for (const t of input.tenders ?? []) {
            const prev = mergedTenders.get(t.tenderType);
            if (prev) {
              mergedTenders.set(t.tenderType, { amount: prev.amount + t.amount, count: prev.count + (t.count ?? 0) });
            } else {
              mergedTenders.set(t.tenderType, { amount: t.amount, count: t.count ?? 0 });
            }
          }

          await tx.tenderEntry.deleteMany({ where: { dailySalesId: existing.id } });

          return tx.dailySales.update({
            where: { id: existing.id },
            data: {
              grossSales: Number(existing.grossSales) + input.grossSales,
              netSales: Number(existing.netSales) + input.netSales,
              tax: Number(existing.tax) + input.tax,
              discounts: Number(existing.discounts) + (input.discounts ?? 0),
              voids: Number(existing.voids) + (input.voids ?? 0),
              refunds: Number(existing.refunds) + (input.refunds ?? 0),
              cateringSales: Number(existing.cateringSales) + (input.cateringSales ?? 0),
              onlineSales: Number(existing.onlineSales) + (input.onlineSales ?? 0),
              deliveryAppSales: Number(existing.deliveryAppSales) + (input.deliveryAppSales ?? 0),
              notes: input.notes ?? existing.notes,
              status: (input.status as any) ?? existing.status,
              tenders: {
                create: Array.from(mergedTenders.entries()).map(([tenderType, v]) => ({
                  workspaceId: ctx.workspaceId,
                  tenderType: tenderType as any,
                  amount: v.amount,
                  count: v.count,
                })),
              },
            },
            include: { tenders: true },
          });
        });
        await writeAudit(ctx, {
          action: "daily_sales.merged",
          entityType: "DailySales",
          entityId: updated.id,
          metadata: { saleDate: input.saleDate },
        });
        log.info({ id: updated.id, saleDate: input.saleDate }, "daily sales merged (add)");
        return updated;
      }

      if (mode === "replace") {
        // Delete existing (cascade tenders), create new
        const record = await prisma.$transaction(async (tx) => {
          await tx.tenderEntry.deleteMany({ where: { dailySalesId: existing.id } });
          await tx.dailySales.delete({ where: { id: existing.id } });
          return tx.dailySales.create({
            data: {
              workspaceId: ctx.workspaceId,
              enteredById: ctx.userId,
              saleDate,
              grossSales: input.grossSales,
              netSales: input.netSales,
              tax: input.tax,
              discounts: input.discounts ?? 0,
              voids: input.voids ?? 0,
              refunds: input.refunds ?? 0,
              cateringSales: input.cateringSales ?? 0,
              onlineSales: input.onlineSales ?? 0,
              deliveryAppSales: input.deliveryAppSales ?? 0,
              notes: input.notes ?? null,
              sourceFileUrl: input.sourceFileUrl ?? null,
              status: (input.status as any) ?? "NO_BUSINESS",
              shift: input.shift ?? null,
              tenders: input.tenders?.length
                ? {
                    create: input.tenders.map((t) => ({
                      workspaceId: ctx.workspaceId,
                      tenderType: t.tenderType as any,
                      amount: t.amount,
                      count: t.count ?? 0,
                    })),
                  }
                : undefined,
            },
            include: { tenders: true },
          });
        });
        await writeAudit(ctx, {
          action: "daily_sales.replaced",
          entityType: "DailySales",
          entityId: record.id,
          metadata: { saleDate: input.saleDate, previousId: existing.id },
        });
        log.info({ id: record.id, saleDate: input.saleDate }, "daily sales replaced");
        return record;
      }
    }

    // No existing record — normal create
    const record = await prisma.dailySales.create({
      data: {
        workspaceId: ctx.workspaceId,
        enteredById: ctx.userId,
        saleDate,
        grossSales: input.grossSales,
        netSales: input.netSales,
        tax: input.tax,
        discounts: input.discounts ?? 0,
        voids: input.voids ?? 0,
        refunds: input.refunds ?? 0,
        cateringSales: input.cateringSales ?? 0,
        onlineSales: input.onlineSales ?? 0,
        deliveryAppSales: input.deliveryAppSales ?? 0,
        notes: input.notes ?? null,
        sourceFileUrl: input.sourceFileUrl ?? null,
        status: (input.status as any) ?? "NO_BUSINESS",
        shift: input.shift ?? null,
        tenders: input.tenders?.length
          ? {
              create: input.tenders.map((t) => ({
                workspaceId: ctx.workspaceId,
                tenderType: t.tenderType as any,
                amount: t.amount,
                count: t.count ?? 0,
              })),
            }
          : undefined,
      },
      include: { tenders: true },
    });

    await writeAudit(ctx, {
      action: "daily_sales.created",
      entityType: "DailySales",
      entityId: record.id,
      metadata: { saleDate: input.saleDate, netSales: input.netSales },
    });

    log.info({ id: record.id, saleDate: input.saleDate }, "daily sales created");
    return record;
  }

  async list(ctx: TenantContext, opts: { from?: string; to?: string; limit?: number }) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const where: any = { workspaceId: ctx.workspaceId };
    if (opts.from || opts.to) {
      where.saleDate = {};
      if (opts.from) where.saleDate.gte = new Date(opts.from);
      if (opts.to) where.saleDate.lte = new Date(opts.to);
    }
    const items = await prisma.dailySales.findMany({
      where,
      take: limit,
      orderBy: { saleDate: "desc" },
      include: { tenders: true },
    });
    return { items };
  }

  async get(ctx: TenantContext, id: string) {
    const record = await prisma.dailySales.findFirst({
      where: { id, workspaceId: ctx.workspaceId },
      include: { tenders: true, enteredBy: { select: { id: true, displayName: true, username: true } } },
    });
    if (!record) throw new NotFoundException({ code: "not_found", message: "Daily sales record not found" });
    return { ...record, variance: this.calcVariance(record) };
  }

  async update(ctx: TenantContext, id: string, input: UpdateDailySalesInput) {
    const existing = await prisma.dailySales.findFirst({
      where: { id, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Daily sales record not found" });

    const updated = await prisma.dailySales.update({
      where: { id },
      data: {
        ...(input.grossSales !== undefined ? { grossSales: input.grossSales } : {}),
        ...(input.netSales !== undefined ? { netSales: input.netSales } : {}),
        ...(input.tax !== undefined ? { tax: input.tax } : {}),
        ...(input.discounts !== undefined ? { discounts: input.discounts } : {}),
        ...(input.voids !== undefined ? { voids: input.voids } : {}),
        ...(input.refunds !== undefined ? { refunds: input.refunds } : {}),
        ...(input.cateringSales !== undefined ? { cateringSales: input.cateringSales } : {}),
        ...(input.onlineSales !== undefined ? { onlineSales: input.onlineSales } : {}),
        ...(input.deliveryAppSales !== undefined ? { deliveryAppSales: input.deliveryAppSales } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.sourceFileUrl !== undefined ? { sourceFileUrl: input.sourceFileUrl } : {}),
        ...(input.status !== undefined ? { status: input.status as any } : {}),
        ...(input.shift !== undefined ? { shift: input.shift } : {}),
        ...(input.tenders !== undefined
          ? {
              tenders: {
                deleteMany: {},
                create: input.tenders.map((t) => ({
                  workspaceId: ctx.workspaceId,
                  tenderType: t.tenderType as any,
                  amount: t.amount,
                  count: t.count ?? 0,
                })),
              },
            }
          : {}),
      },
      include: { tenders: true },
    });

    await writeAudit(ctx, {
      action: "daily_sales.updated",
      entityType: "DailySales",
      entityId: id,
    });
    return { ...updated, variance: this.calcVariance(updated) };
  }

  async delete(ctx: TenantContext, id: string) {
    const existing = await prisma.dailySales.findFirst({
      where: { id, workspaceId: ctx.workspaceId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException({ code: "not_found", message: "Daily sales record not found" });
    await prisma.dailySales.delete({ where: { id } });
    await writeAudit(ctx, { action: "daily_sales.deleted", entityType: "DailySales", entityId: id });
    return { deleted: true };
  }

  async getVariance(ctx: TenantContext, id: string) {
    const record = await prisma.dailySales.findFirst({
      where: { id, workspaceId: ctx.workspaceId },
      include: { tenders: true },
    });
    if (!record) throw new NotFoundException({ code: "not_found", message: "Daily sales record not found" });
    return this.calcVariance(record);
  }

  private calcVariance(record: { netSales: any; tenders: Array<{ amount: any }> }) {
    const netSales = Number(record.netSales);
    const tenderTotal = record.tenders.reduce((sum, t) => sum + Number(t.amount), 0);
    return {
      netSales,
      tenderTotal: parseFloat(tenderTotal.toFixed(2)),
      variance: parseFloat((tenderTotal - netSales).toFixed(2)),
      balanced: Math.abs(tenderTotal - netSales) < 0.01,
    };
  }
}
