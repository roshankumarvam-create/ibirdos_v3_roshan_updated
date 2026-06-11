import { Controller, Get, Query } from "@nestjs/common";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ReportsService } from "./reports.service";

function parseRange(q: any): { from: Date; to: Date } {
  const from = q.from ? new Date(q.from) : new Date(Date.now() - 30 * 86400_000);
  const to = q.to ? new Date(q.to) : new Date();
  return { from, to };
}

@Controller("reports")
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get("food-cost-vs-sales")
  @RequirePermission("analytics.read")
  foodCost(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.getFoodCostVsSales(ctx, parseRange(q)).then(ok);
  }

  @Get("labor-cost-vs-sales")
  @RequirePermission("analytics.read")
  laborCost(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.getLaborCostVsSales(ctx, parseRange(q)).then(ok);
  }

  @Get("rent-vs-sales")
  @RequirePermission("analytics.finance.read")
  rentVsSales(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    const month = q.month ?? new Date().toISOString().slice(0, 7);
    return this.svc.getRentVsSales(ctx, month).then(ok);
  }

  @Get("prime-cost")
  @RequirePermission("analytics.read")
  primeCost(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.getPrimeCost(ctx, parseRange(q)).then(ok);
  }

  @Get("sales-by-period")
  @RequirePermission("analytics.read")
  salesByPeriod(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    const granularity = (["day", "week", "month"].includes(q.granularity) ? q.granularity : "day") as "day" | "week" | "month";
    return this.svc.getSalesByPeriod(ctx, granularity, parseRange(q)).then(ok);
  }

  @Get("low-margin-events")
  @RequirePermission("analytics.read")
  lowMarginEvents(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    const threshold = q.threshold ? Number(q.threshold) : 30;
    return this.svc.getLowMarginEvents(ctx, threshold).then(ok);
  }

  @Get("catering-vs-events")
  @RequirePermission("analytics.read")
  cateringVsEvents(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.getCateringVsEventProfit(ctx, parseRange(q)).then(ok);
  }

  @Get("vendor-price-changes")
  @RequirePermission("analytics.read")
  vendorPriceChanges(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.getVendorPriceChangeReport(ctx, parseRange(q)).then(ok);
  }

  @Get("cost-alerts")
  @RequirePermission("analytics.read")
  costAlerts(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.getCostAlertReport(ctx, parseRange(q)).then(ok);
  }

  @Get("vendor-aging")
  @RequirePermission("analytics.finance.read")
  vendorAging(@CurrentCtx() ctx: TenantContext) {
    return this.svc.getVendorAging(ctx).then(ok);
  }
}
