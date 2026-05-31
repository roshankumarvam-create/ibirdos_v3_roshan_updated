import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { InventoryService } from "./inventory.service";

const AdjustSchema = z.object({
  quantity: z.number(),  // signed; negative = remove
  unit: z.string().min(1).max(16),
  reason: z.string().min(1).max(500),
});

@Controller("inventory")
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get("transactions") @RequirePermission("inventory.read")
  list(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.listTransactions(ctx, {
      ingredientId: q.ingredientId, kind: q.kind,
      limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor,
    }).then(ok);
  }

  @Get("alerts/low-stock") @RequirePermission("inventory.read")
  alerts(@CurrentCtx() ctx: TenantContext, @Query("status") status?: string): Promise<any> {
    return this.svc.listLowStockAlerts(ctx, (status as any) ?? "OPEN").then((items) => ok({ items }));
  }

  @Post("ingredients/:id/adjust") @RequirePermission("inventory.adjust")
  adjust(@CurrentCtx() ctx: TenantContext, @Param("id") id: string,
         @Body(new ZodValidationPipe(AdjustSchema)) body: z.infer<typeof AdjustSchema>): Promise<any> {
    return this.svc.adjust(ctx, id, body).then(ok);
  }

  @Post("transactions/:id/reverse") @RequirePermission("inventory.adjust")
  reverse(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.reverseTransaction(ctx, id).then(ok);
  }
}
