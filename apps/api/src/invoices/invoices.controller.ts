import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
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

const CreateLineSchema = z.object({
  descriptionRaw: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  unitPriceCents: z.number().int().nonnegative(),
  extendedPriceCents: z.number().int().nonnegative(),
  category: z.enum(["FOOD_INGREDIENT", "PACKAGING", "LABOR", "DELIVERY", "TAX", "DISCOUNT", "IGNORED"]).default("FOOD_INGREDIENT"),
  committedIngredientId: z.string().nullable().optional(),
  packSize: z.number().positive().nullable().optional(),
  packUnit: z.string().nullable().optional(),
  notes: z.string().max(500).optional(),
});

const UpdateInvoiceHeaderSchema = z.object({
  vendorId:      z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate:   z.string().nullable().optional(),
  dueDate:       z.string().nullable().optional(),
  subtotalCents: z.number().int().nonnegative().nullable().optional(),
  taxCents:      z.number().int().nonnegative().nullable().optional(),
  totalCents:    z.number().int().nonnegative().nullable().optional(),
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

  @Patch(":id")
  @RequirePermission("invoice.review")
  async updateHeader(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateInvoiceHeaderSchema)) body: z.infer<typeof UpdateInvoiceHeaderSchema>,
  ): Promise<any> {
    return ok(await this.svc.updateHeader(ctx, id, body));
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

  @Post(":id/lines")
  @RequirePermission("invoice.review")
  async addLine(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CreateLineSchema)) body: z.infer<typeof CreateLineSchema>,
  ): Promise<any> {
    return ok(await this.svc.addLine(ctx, id, body));
  }

  @Delete(":id/lines/:lineId")
  @RequirePermission("invoice.review")
  async deleteLine(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
  ): Promise<any> {
    return ok(await this.svc.deleteLine(ctx, id, lineId));
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
