import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { EventsService } from "./events.service";

const CreateEventSchema = z.object({
  name: z.string().min(1).max(160),
  status: z.enum(["DRAFT", "CONFIRMED", "PREP_IN_PROGRESS", "IN_SERVICE", "COMPLETED", "CANCELLED"]).optional(),
  serviceType: z.enum(["BUFFET", "PLATED", "FAMILY_STYLE", "COCKTAIL", "BOXED", "DROP_OFF", "OTHER"]).optional(),
  customerName: z.string().max(120).optional(),
  customerContact: z.string().max(200).optional(),
  venueAddress: z.string().max(500).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  prepStartsAt: z.string().datetime().optional(),
  guestCount: z.number().int().positive(),
  portionMultiplier: z.number().min(1).max(2).optional(),
  quotedPriceCents: z.number().int().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
});

const AddMenuSchema = z.object({
  recipeId: z.string(),
  portions: z.number().int().positive(),
  perItemMultiplier: z.number().min(1).max(2).optional(),
  notes: z.string().max(500).optional(),
});

const AssignStaffSchema = z.object({
  userId: z.string().optional(),
  role: z.enum(["HEAD_CHEF", "LINE_COOK", "PREP_COOK", "SERVER", "BARTENDER", "DRIVER", "COORDINATOR", "OTHER"]),
  hours: z.number().positive(),
  hourlyRateCents: z.number().int().nonnegative(),
  notes: z.string().max(500).optional(),
});

@Controller("events")
export class EventsController {
  constructor(private readonly svc: EventsService) {}

  @Get() @RequirePermission("event.read")
  list(@CurrentCtx() ctx: TenantContext, @Query() q: any): Promise<any> {
    return this.svc.list(ctx, {
      status: q.status, upcoming: q.upcoming === "true",
      cursor: q.cursor, limit: q.limit ? Number(q.limit) : undefined,
    }).then(ok);
  }

  @Post() @RequirePermission("event.create")
  create(@CurrentCtx() ctx: TenantContext, @Body(new ZodValidationPipe(CreateEventSchema)) body: any): Promise<any> {
    return this.svc.create(ctx, body).then(ok);
  }

  @Get(":id") @RequirePermission("event.read")
  get(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.get(ctx, id).then(ok);
  }

  @Post(":id/menu") @RequirePermission("event.update")
  addMenu(@CurrentCtx() ctx: TenantContext, @Param("id") id: string,
          @Body(new ZodValidationPipe(AddMenuSchema)) body: any): Promise<any> {
    return this.svc.addMenuItem(ctx, id, body).then(ok);
  }

  @Post(":id/staff") @RequirePermission("event.assign_staff")
  assignStaff(@CurrentCtx() ctx: TenantContext, @Param("id") id: string,
              @Body(new ZodValidationPipe(AssignStaffSchema)) body: any): Promise<any> {
    return this.svc.assignStaff(ctx, id, body).then(ok);
  }

  @Post(":id/kitchen-packet/generate") @RequirePermission("event.update")
  generatePacket(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.generateKitchenPacket(ctx, id).then(ok);
  }
}
