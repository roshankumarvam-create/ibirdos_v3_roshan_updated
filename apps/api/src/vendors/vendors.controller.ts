import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ok, CreateVendorSchema, type CreateVendorInput } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";

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
}
