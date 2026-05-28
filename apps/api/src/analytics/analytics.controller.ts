import { Controller, Get, Param, Query } from "@nestjs/common";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get("summary") @RequirePermission("analytics.read")
  summary(@CurrentCtx() ctx: TenantContext, @Query("days") days?: string) {
    return this.svc.summary(ctx, days ? Number(days) : 30).then(ok);
  }

  @Get("recipes/top-margin") @RequirePermission("analytics.read")
  topMargin(@CurrentCtx() ctx: TenantContext, @Query("limit") limit?: string) {
    return this.svc.topRecipesByMargin(ctx, limit ? Number(limit) : 10).then((items) => ok({ items }));
  }

  @Get("recipes/low-margin") @RequirePermission("analytics.read")
  lowMargin(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.lowMarginRecipes(ctx, q.threshold ? Number(q.threshold) : 30, q.limit ? Number(q.limit) : 10).then((items) => ok({ items }));
  }

  @Get("ingredients/:id/price-trend") @RequirePermission("analytics.read")
  priceTrend(@CurrentCtx() ctx: TenantContext, @Param("id") id: string, @Query("days") days?: string) {
    return this.svc.ingredientPriceTrend(ctx, id, days ? Number(days) : 90).then((points) => ok({ points }));
  }

  @Get("waste/by-reason") @RequirePermission("analytics.read")
  wasteByReason(@CurrentCtx() ctx: TenantContext, @Query("days") days?: string) {
    return this.svc.wasteByReason(ctx, days ? Number(days) : 30).then((items) => ok({ items }));
  }

  @Get("pnl") @RequirePermission("analytics.finance.read")
  pnl(@CurrentCtx() ctx: TenantContext, @Query("days") days?: string) {
    return this.svc.profitAndLoss(ctx, days ? Number(days) : 30).then(ok);
  }
}
