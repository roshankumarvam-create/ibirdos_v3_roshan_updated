import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentCtx() ctx: TenantContext, @Query() q: any): Promise<any> {
    return this.svc.list(ctx, {
      unreadOnly: q.unreadOnly === "true",
      limit: q.limit ? Number(q.limit) : undefined,
    }).then(ok);
  }

  @Post(":id/read")
  read(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.markRead(ctx, id).then(ok);
  }

  @Post("read-all")
  readAll(@CurrentCtx() ctx: TenantContext) {
    return this.svc.markAllRead(ctx).then(ok);
  }

  @Post(":id/dismiss")
  dismiss(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.dismiss(ctx, id).then(ok);
  }
}
