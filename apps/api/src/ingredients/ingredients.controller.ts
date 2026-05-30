import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from "@nestjs/common";
import { z } from "zod";

import {
  ok, CreateIngredientSchema, UpdateIngredientSchema, MatchIngredientSchema,
  type CreateIngredientInput, type UpdateIngredientInput, type MatchIngredientInput,
} from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";

import { IngredientsService } from "./ingredients.service";

const UpdatePriceSchema = z.object({
  pricePerCanonicalCents: z.number().nonnegative(),
  source: z.enum(["MANUAL", "INVOICE", "VENDOR_API", "IMPORTED"]).default("MANUAL"),
  sourceRef: z.string().optional(),
  vendorId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

const ListQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const AddAliasSchema = z.object({
  text: z.string().min(1).max(500),
  source: z.enum(["MANUAL", "INVOICE", "RECIPE"]).default("MANUAL"),
});

@Controller("ingredients")
export class IngredientsController {
  constructor(private readonly svc: IngredientsService) {}

  @Get()
  @RequirePermission("ingredient.read")
  async list(@CurrentCtx() ctx: TenantContext, @Query() query: any) {
    const q = ListQuerySchema.parse(query);
    return ok(await this.svc.list(ctx, q));
  }

  @Post()
  @RequirePermission("ingredient.create")
  async create(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(CreateIngredientSchema)) body: CreateIngredientInput,
  ) {
    return ok(await this.svc.create(ctx, body));
  }

  @Get(":id")
  @RequirePermission("ingredient.read")
  async get(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return ok(await this.svc.get(ctx, id));
  }

  @Patch(":id")
  @RequirePermission("ingredient.update")
  async update(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateIngredientSchema)) body: UpdateIngredientInput,
  ): Promise<any> {
    return ok(await this.svc.update(ctx, id, body));
  }

  @Post(":id/price")
  @RequirePermission("ingredient.update_cost")
  async updatePrice(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePriceSchema)) body: z.infer<typeof UpdatePriceSchema>,
  ): Promise<any> {
    return ok(await this.svc.updatePrice(ctx, id, body));
  }

  @Post(":id/aliases")
  @RequirePermission("ingredient.update")
  async addAlias(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AddAliasSchema)) body: z.infer<typeof AddAliasSchema>,
  ): Promise<any> {
    return ok(await this.svc.addAlias(ctx, id, body.text, body.source));
  }

  @Post("match")
  @RequirePermission("ingredient.match")
  async match(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(MatchIngredientSchema)) body: MatchIngredientInput,
  ) {
    return ok({ matches: await this.svc.match(ctx, body) });
  }
}
