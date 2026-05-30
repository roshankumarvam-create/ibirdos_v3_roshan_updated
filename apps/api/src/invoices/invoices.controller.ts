import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { InvoicesService } from "./invoices.service";

const CreateInvoiceSchema = z.object({
  uploadKey: z.string().min(1),
  uploadMimeType: z.string().min(1),
  uploadSizeBytes: z.number().int().positive(),
  vendorId: z.string().optional(),
});

const UpdateLineSchema = z.object({
  descriptionRaw: z.string().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().optional(),
  unitPriceCents: z.number().int().optional(),
  extendedPriceCents: z.number().int().optional(),
  category: z.enum(["FOOD_INGREDIENT", "PACKAGING", "LABOR", "DELIVERY", "TAX", "DISCOUNT", "IGNORED"]).optional(),
  committedIngredientId: z.string().nullable().optional(),
  excluded: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

const ListQuerySchema = z.object({
  status: z.string().optional(),
  vendorId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller("invoices")
export class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}

  @Get()
  @RequirePermission("invoice.read")
  async list(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return ok(await this.svc.list(ctx, ListQuerySchema.parse(q)));
  }

  @Post()
  @RequirePermission("invoice.upload")
  async create(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(CreateInvoiceSchema)) body: z.infer<typeof CreateInvoiceSchema>,
  ) {
    return ok(await this.svc.create(ctx, body));
  }

  @Get(":id")
  @RequirePermission("invoice.read")
  async get(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return ok(await this.svc.get(ctx, id));
  }

  @Patch(":id/lines/:lineId")
  @RequirePermission("invoice.review")
  async updateLine(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(UpdateLineSchema)) body: z.infer<typeof UpdateLineSchema>,
  ): Promise<any> {
    return ok(await this.svc.updateLine(ctx, id, lineId, body));
  }

  @Post(":id/confirm")
  @RequirePermission("invoice.confirm")
  async confirm(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return ok(await this.svc.confirm(ctx, id));
  }

  @Post(":id/retry")
  @RequirePermission("invoice.upload")
  async retry(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return ok(await this.svc.retryExtraction(ctx, id));
  }
}
