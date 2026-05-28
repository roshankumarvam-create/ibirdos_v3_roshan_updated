import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import type { CreateVendorInput } from "@ibirdos/types";

@Injectable()
export class VendorsService {
  async create(ctx: TenantContext, input: CreateVendorInput) {
    const vendor = await prisma.vendor.create({
      data: {
        workspaceId: ctx.workspaceId,
        createdById: ctx.userId,
        name: input.name.trim(),
        code: input.code ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        notes: input.notes ?? null,
      },
    });
    await writeAudit(ctx, {
      action: "vendor.created",
      entityType: "Vendor",
      entityId: vendor.id,
      metadata: { name: vendor.name },
    });
    return vendor;
  }

  async list(ctx: TenantContext) {
    return prisma.vendor.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { ingredients: true } } },
    });
  }

  async get(ctx: TenantContext, id: string) {
    const v = await prisma.vendor.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!v) throw new NotFoundException({ code: "not_found", message: "Vendor not found" });
    return v;
  }
}
