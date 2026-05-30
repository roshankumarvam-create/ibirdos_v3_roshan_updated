import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";

@Injectable()
export class InsightsService {
  async list(ctx: TenantContext, opts: { status?: string; kind?: string; severity?: string; limit?: number }): Promise<any> {
    const where: any = { workspaceId: ctx.workspaceId };
    where.status = opts.status ?? "OPEN";
    if (opts.kind) where.kind = opts.kind;
    if (opts.severity) where.severity = opts.severity;
    return prisma.insight.findMany({
      where, take: Math.min(opts.limit ?? 50, 100),
      orderBy: [{ severity: "desc" }, { confidence: "desc" }, { createdAt: "desc" }],
    });
  }

  async get(ctx: TenantContext, id: string): Promise<any> {
    const i = await prisma.insight.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!i) throw new NotFoundException({ code: "not_found", message: "Insight not found" });
    return i;
  }

  async acknowledge(ctx: TenantContext, id: string): Promise<any> {
    const i = await prisma.insight.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!i) throw new NotFoundException({ code: "not_found", message: "Insight not found" });
    const updated = await prisma.insight.update({
      where: { id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: ctx.userId },
    });
    await writeAudit(ctx, { action: "insight.acknowledged", entityType: "Insight", entityId: id });
    return updated;
  }

  async dismiss(ctx: TenantContext, id: string): Promise<any> {
    const i = await prisma.insight.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!i) throw new NotFoundException({ code: "not_found", message: "Insight not found" });
    const updated = await prisma.insight.update({
      where: { id }, data: { status: "DISMISSED", dismissedAt: new Date() },
    });
    await writeAudit(ctx, { action: "insight.dismissed", entityType: "Insight", entityId: id });
    return updated;
  }

  async markActioned(ctx: TenantContext, id: string): Promise<any> {
    const i = await prisma.insight.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!i) throw new NotFoundException({ code: "not_found", message: "Insight not found" });
    const updated = await prisma.insight.update({ where: { id }, data: { status: "ACTIONED" } });
    await writeAudit(ctx, { action: "insight.actioned", entityType: "Insight", entityId: id });
    return updated;
  }
}
