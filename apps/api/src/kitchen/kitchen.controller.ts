import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { KitchenService } from "./kitchen.service";

const UpdateSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]).optional(),
  blockReason: z.string().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
  station: z.enum(["GRILL", "SAUTE", "FRY", "PASTRY", "PREP", "PIZZA", "SALAD", "GARDE_MANGER", "EXPO", "OTHER"]).optional(),
  notes: z.string().max(1000).optional(),
});

@Controller("kitchen")
export class KitchenController {
  constructor(private readonly svc: KitchenService) {}

  @Get("tasks") @RequirePermission("kitchen.read")
  board(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.listForBoard(ctx, { eventId: q.eventId, station: q.station, assignedToMe: q.mine === "true" }).then((items) => ok({ items }));
  }

  @Post("events/:eventId/explode") @RequirePermission("event.update")
  explode(@CurrentCtx() ctx: TenantContext, @Param("eventId") eventId: string) {
    return this.svc.explodeFromEvent(ctx, eventId).then(ok);
  }

  @Patch("tasks/:id") @RequirePermission("kitchen.update_task")
  update(@CurrentCtx() ctx: TenantContext, @Param("id") id: string,
         @Body(new ZodValidationPipe(UpdateSchema)) body: any) {
    return this.svc.updateTask(ctx, id, body).then(ok);
  }
}
