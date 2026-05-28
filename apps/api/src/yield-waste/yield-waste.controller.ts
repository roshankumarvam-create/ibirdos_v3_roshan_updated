import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { YieldWasteService } from "./yield-waste.service";

const YieldSchema = z.object({
  ingredientId: z.string(),
  rawQuantity: z.number().positive(), rawUnit: z.string(),
  yieldQuantity: z.number().positive(), yieldUnit: z.string(),
  recipeId: z.string().optional(), notes: z.string().max(500).optional(),
});

const WasteSchema = z.object({
  ingredientId: z.string(),
  quantity: z.number().positive(), unit: z.string(),
  reason: z.enum(["SPOILAGE", "OVERPRODUCTION", "TRIM_LOSS", "COOKING_ERROR", "CUSTOMER_RETURN", "DROPPED", "EXPIRED", "OTHER"]),
  recipeId: z.string().optional(), eventId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

@Controller("yield-waste")
export class YieldWasteController {
  constructor(private readonly svc: YieldWasteService) {}

  @Post("yield") @RequirePermission("yield.create")
  recordYield(@CurrentCtx() ctx: TenantContext, @Body(new ZodValidationPipe(YieldSchema)) body: any) {
    return this.svc.recordYield(ctx, body).then(ok);
  }

  @Get("yield") @RequirePermission("yield.read")
  listYield(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.listYield(ctx, { ingredientId: q.ingredientId, limit: q.limit ? Number(q.limit) : undefined }).then((items) => ok({ items }));
  }

  @Post("waste") @RequirePermission("waste.create")
  recordWaste(@CurrentCtx() ctx: TenantContext, @Body(new ZodValidationPipe(WasteSchema)) body: any) {
    return this.svc.recordWaste(ctx, body).then(ok);
  }

  @Get("waste") @RequirePermission("waste.read")
  listWaste(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.listWaste(ctx, {
      ingredientId: q.ingredientId, reason: q.reason,
      limit: q.limit ? Number(q.limit) : undefined,
      sinceDays: q.sinceDays ? Number(q.sinceDays) : undefined,
    }).then((items) => ok({ items }));
  }
}
