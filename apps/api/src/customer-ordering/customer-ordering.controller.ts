import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";

import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/guards/rate-limit.guard";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { CustomerOrderingService } from "./customer-ordering.service";

const QuoteSchema = z.object({
  workspaceSlug: z.string(),
  customerEmail: z.string().email(),
  customerName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  serviceType: z.enum(["BUFFET", "PLATED", "FAMILY_STYLE", "COCKTAIL", "BOXED", "DROP_OFF", "OTHER"]),
  guestCount: z.number().int().positive().max(10000),
  scheduledFor: z.string().datetime(),
  venueAddress: z.string().max(500).optional(),
  items: z.array(z.object({
    recipeId: z.string(),
    portions: z.number().int().positive(),
    portionSize: z.enum(["REGULAR", "LARGE"]).optional(),
  })).min(1).max(50),
  addons: z.object({
    utensils: z.boolean().optional(),
    staffHours: z.number().nonnegative().max(100).optional(),
    deliveryMiles: z.number().nonnegative().max(500).optional(),
  }).optional(),
  notes: z.string().max(1000).optional(),
});

@Controller("public")
export class CustomerOrderingController {
  constructor(private readonly svc: CustomerOrderingService) {}

  @Public() @Get("menu/:slug")
  @RateLimit({ limit: 30, windowSec: 60 })
  menu(@Param("slug") slug: string) {
    return this.svc.publicMenu(slug).then(ok);
  }

  @Public() @Post("orders/quote")
  @RateLimit({ limit: 10, windowSec: 60 })
  quote(@Body(new ZodValidationPipe(QuoteSchema)) body: z.infer<typeof QuoteSchema>) {
    return this.svc.buildQuote(body).then(ok);
  }

  @Public() @Post("orders/:id/checkout")
  @RateLimit({ limit: 5, windowSec: 60 })
  checkout(@Param("id") id: string) {
    return this.svc.checkout(id).then(ok);
  }

  /** Dev/webhook endpoint — production replaces this with /webhooks/stripe verifying signature */
  @Public() @Post("orders/:id/confirm-payment")
  confirmPayment(@Param("id") id: string, @Body() body: { stripePaymentIntentId?: string }) {
    return this.svc.confirmPayment(id, body ?? {}).then(ok);
  }

  @Public() @Get("orders/:id")
  @RateLimit({ limit: 30, windowSec: 60 })
  getOrder(@Param("id") id: string) {
    return this.svc.getOrder(id).then(ok);
  }
}
