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
  tenders?: Array<{ tenderType: string; amount: number; count?: number }>;
}

@Injectable()
export class DailySalesService {
  async create(ctx: TenantContext, input: CreateDailySalesInput) {
    const saleDate = new Date(input.saleDate);
    if (isNaN(saleDate.getTime())) {
      throw new BadRequestException({ code: "validation_failed", message: "Invalid saleDate" });
    }

    // Check for duplicate date
    const existing = await prisma.dailySales.findFirst({
      where: { workspaceId: ctx.workspaceId, saleDate },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: "conflict",
        message: `Daily sales for ${input.saleDate} already exists`,
      });
    }

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
