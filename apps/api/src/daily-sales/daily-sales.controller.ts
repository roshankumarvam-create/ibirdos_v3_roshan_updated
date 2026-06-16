import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UsePipes,
} from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { DailySalesService } from "./daily-sales.service";

const TenderSchema = z.object({
  tenderType: z.enum([
    "CASH","VISA","MASTERCARD","AMEX","DISCOVER","CHECK","ACH_INVOICE",
    "CREDIT_CARD","DEBIT_CARD","GIFT_CARD","ONLINE_PAYMENT",
    "DELIVERY_APP","CATERING_INVOICE","HOUSE_ACCOUNT","OTHER",
  ]),
  amount: z.number().nonnegative(),
  count: z.number().int().nonnegative().default(0),
});

const CreateSchema = z.object({
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  grossSales: z.number().nonnegative(),
  netSales: z.number().nonnegative(),
  tax: z.number().nonnegative(),
  discounts: z.number().nonnegative().default(0),
  voids: z.number().nonnegative().default(0),
  refunds: z.number().nonnegative().default(0),
  cateringSales: z.number().nonnegative().default(0),
  onlineSales: z.number().nonnegative().default(0),
  deliveryAppSales: z.number().nonnegative().default(0),
  notes: z.string().max(1000).optional(),
  sourceFileUrl: z.string().url().optional(),
  status: z.enum(["NO_BUSINESS","CLOSED_WON","LOST","FOLLOW_UP"]).optional(),
  tenders: z.array(TenderSchema).optional(),
});

const UpdateSchema = CreateSchema.omit({ saleDate: true }).partial();

const ListQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller("daily-sales")
export class DailySalesController {
  constructor(private readonly svc: DailySalesService) {}

  @Post()
  @RequirePermission("daily_sales.create")
  @UsePipes(new ZodValidationPipe(CreateSchema))
  create(@CurrentCtx() ctx: TenantContext, @Body() body: z.infer<typeof CreateSchema>) {
    return this.svc.create(ctx, body).then(ok);
  }

  @Get()
  @RequirePermission("daily_sales.read")
  list(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    const parsed = ListQuerySchema.parse(q);
    return this.svc.list(ctx, parsed).then(ok);
  }

  @Get(":id")
  @RequirePermission("daily_sales.read")
  get(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return this.svc.get(ctx, id).then(ok);
  }

  @Patch(":id")
  @RequirePermission("daily_sales.update")
  @UsePipes(new ZodValidationPipe(UpdateSchema))
  update(@CurrentCtx() ctx: TenantContext, @Param("id") id: string, @Body() body: z.infer<typeof UpdateSchema>) {
    return this.svc.update(ctx, id, body).then(ok);
  }

  @Delete(":id")
  @RequirePermission("daily_sales.delete")
  remove(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return this.svc.delete(ctx, id).then(ok);
  }
}
