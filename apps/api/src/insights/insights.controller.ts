import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { InsightsService } from "./insights.service";

@Controller("insights")
export class InsightsController {
  constructor(private readonly svc: InsightsService) {}

  @Get() @RequirePermission("analytics.read")
  list(@CurrentCtx() ctx: TenantContext, @Query() q: any): Promise<any> {
    return this.svc.list(ctx, {
      status: q.status, kind: q.kind, severity: q.severity,
      limit: q.limit ? Number(q.limit) : undefined,
    }).then((items) => ok({ items }));
  }

  @Get(":id") @RequirePermission("analytics.read")
  get(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.get(ctx, id).then(ok);
  }

  @Post(":id/acknowledge") @RequirePermission("analytics.read")
  ack(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.acknowledge(ctx, id).then(ok);
  }

  @Post(":id/dismiss") @RequirePermission("analytics.read")
  dismiss(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.dismiss(ctx, id).then(ok);
  }

  @Post(":id/actioned") @RequirePermission("analytics.read")
  actioned(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.markActioned(ctx, id).then(ok);
  }

  /** Manual trigger — runs all detectors immediately for current workspace. */
  @Post("_internal/run-now") @RequirePermission("analytics.read")
  runNow(@CurrentCtx() ctx: TenantContext): Promise<any> {
    return this.svc.runScan(ctx).then(ok);
  }
}
