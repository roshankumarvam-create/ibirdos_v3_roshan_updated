import { Body, Controller, Get, Headers, Post, Query, Req, RawBodyRequest, BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";
import type Stripe from "stripe";
import type { Request } from "express";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { Public } from "../common/decorators/public.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { BillingService } from "./billing.service";
import { env } from "@ibirdos/config";

const CheckoutSchema = z.object({
  plan: z.enum(["SOLO", "KITCHEN"]),
  interval: z.enum(["month", "year"]).default("month"),
  billingEmail: z.string().email(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const PortalSchema = z.object({ returnUrl: z.string().url() });

@Controller("billing")
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Get("plans") @RequirePermission("workspace.read")
  plans(): Promise<any> {
    return this.svc.listPlans().then((items) => ok({ items }));
  }

  @Get("subscription") @RequirePermission("workspace.read")
  current(@CurrentCtx() ctx: TenantContext) {
    return this.svc.currentSubscription(ctx.workspaceId).then(ok);
  }

  @Get("payments") @RequirePermission("billing.read")
  history(@CurrentCtx() ctx: TenantContext, @Query("limit") limit?: string): Promise<any> {
    return this.svc.paymentHistory(ctx.workspaceId, limit ? Number(limit) : 50).then((items) => ok({ items }));
  }

  @Post("checkout") @RequirePermission("billing.manage")
  checkout(@CurrentCtx() ctx: TenantContext, @Body(new ZodValidationPipe(CheckoutSchema)) body: z.infer<typeof CheckoutSchema>) {
    return this.svc.createCheckoutSession(ctx, body).then(ok);
  }

  @Post("portal") @RequirePermission("billing.manage")
  portal(@CurrentCtx() ctx: TenantContext, @Body(new ZodValidationPipe(PortalSchema)) body: z.infer<typeof PortalSchema>) {
    return this.svc.createPortalSession(ctx, body.returnUrl).then(ok);
  }

  /** Webhook receiver. Bypasses auth (signature is the auth). */
  @Public() @Post("webhook")
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature: string) {
    if (!signature) throw new BadRequestException({ code: "validation_failed", message: "Missing stripe-signature header" });
    if (!env.STRIPE_WEBHOOK_SECRET) throw new BadRequestException({ code: "billing_not_configured", message: "STRIPE_WEBHOOK_SECRET not configured" });
    if (!req.rawBody) throw new BadRequestException({ code: "validation_failed", message: "Missing raw body" });

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(env.STRIPE_SECRET_KEY!, { apiVersion: "2024-12-18.acacia" as any });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      throw new BadRequestException({ code: "webhook_signature_invalid", message: err.message });
    }

    await this.svc.handleWebhookEvent(event);
    return { received: true };
  }
}
