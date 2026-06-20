import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { ok, CreateVendorSchema, type CreateVendorInput } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";

const UpdateVendorSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().max(80).nullable().optional(),
  contactEmail: z.string().email().max(200).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

import { VendorsService } from "./vendors.service";

@Controller("vendors")
export class VendorsController {
  constructor(private readonly svc: VendorsService) {}

  @Get()
  @RequirePermission("vendor.read")
  async list(@CurrentCtx() ctx: TenantContext) {
    return ok({ items: await this.svc.list(ctx) });
  }

  @Post()
  @RequirePermission("vendor.create")
  async create(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(CreateVendorSchema)) body: CreateVendorInput,
  ) {
    return ok(await this.svc.create(ctx, body));
  }

  @Get(":id")
  @RequirePermission("vendor.read")
  async get(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return ok(await this.svc.get(ctx, id));
  }

  @Patch(":id")
  @RequirePermission("vendor.update")
  async update(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateVendorSchema)) body: z.infer<typeof UpdateVendorSchema>,
  ) {
    return ok(await this.svc.update(ctx, id, body));
  }
}
