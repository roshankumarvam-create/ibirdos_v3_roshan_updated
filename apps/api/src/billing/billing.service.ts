// =====================================================================
// Real Stripe billing service.
// =====================================================================
// Implements: customer creation, subscription create/upgrade/cancel,
// customer portal redirect, webhook event handling.
//
// Production design:
//   - Subscription state is BOTH in Stripe (source of truth for $$)
//     AND in our DB (source of truth for "what does the app gate on").
//     The webhook is the only writer that flips status in our DB.
//   - All webhook events are persisted to PaymentEvent before any
//     side-effect, so we can re-run the event handler if it fails.
//   - Webhook handler uses stripe.webhooks.constructEvent for
//     signature verification — no naked POSTs accepted.
// =====================================================================

import {
  Injectable, NotFoundException, BadRequestException, HttpException, HttpStatus,
} from "@nestjs/common";
import Stripe from "stripe";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("BillingService");

type PlanKey = "SOLO" | "KITCHEN" | "ENTERPRISE";

// IBirdOS real pricing catalog (static — no DB needed)
const IBIRDOS_PLANS = [
  {
    id: "SOLO",
    plan: "SOLO",
    displayName: "Solo",
    priceCents: 2900,
    unitAmountMonthlyCents: 2900,
    seatsIncluded: 1,
    comingSoon: false,
    features: ["Owner role only", "All operational features", "Manual invoice + recipe + inventory", "AI insights daily"],
  },
  {
    id: "KITCHEN",
    plan: "KITCHEN",
    displayName: "Kitchen",
    priceCents: 14900,
    unitAmountMonthlyCents: 14900,
    seatsIncluded: 5,
    comingSoon: false,
    features: ["1 Owner + 1 Manager + 3 Chef/Staff", "Everything in Solo", "Role-based access control", "Multi-user kitchen tasks", "Priority support"],
  },
  {
    id: "ENTERPRISE",
    plan: "ENTERPRISE",
    displayName: "Enterprise",
    priceCents: null,
    unitAmountMonthlyCents: null,
    seatsIncluded: null,
    comingSoon: true,
    features: ["Custom seat counts", "SLA + uptime guarantee", "Dedicated CSM", "Custom integrations", "Contact for pricing"],
  },
] as const;

@Injectable()
export class BillingService {
  private stripe: Stripe | null = null;

  constructor() {
    if (env.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(env.STRIPE_SECRET_KEY, {
        apiVersion: "2024-12-18.acacia" as any,
        typescript: true,
      });
    }
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new HttpException(
        { code: "billing_not_configured", message: "Stripe is not configured. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID_SOLO / STRIPE_PRICE_ID_KITCHEN to .env to enable billing." },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.stripe;
  }

  // -----------------------------------------------------------------
  // Plan catalog (static — no DB needed)
  // -----------------------------------------------------------------

  async listPlans(): Promise<any> {
    return IBIRDOS_PLANS;
  }

  // -----------------------------------------------------------------
  // Subscription lifecycle
  // -----------------------------------------------------------------

  /** Get or create Stripe customer + DB BillingCustomer for this workspace. */
  async ensureCustomer(ctx: TenantContext, billingEmail: string) {
    const stripe = this.requireStripe();
    const existing = await prisma.billingCustomer.findUnique({
      where: { workspaceId: ctx.workspaceId },
    });
    if (existing) return existing;

    const workspace = await prisma.workspace.findUnique({
      where: { id: ctx.workspaceId },
    });
    if (!workspace) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });

    const stripeCustomer = await stripe.customers.create({
      email: billingEmail,
      name: workspace.name,
      metadata: { workspaceId: workspace.id, slug: workspace.slug },
    });

    const customer = await prisma.billingCustomer.create({
      data: {
        workspaceId: ctx.workspaceId,
        stripeCustomerId: stripeCustomer.id,
        billingEmail,
      },
    });

    await writeAudit(ctx, {
      action: "billing.customer_created",
      entityType: "BillingCustomer",
      entityId: customer.id,
      metadata: { stripeCustomerId: stripeCustomer.id },
    });
    return customer;
  }

  /** Create a checkout session for a plan + interval. */
  async createCheckoutSession(
    ctx: TenantContext,
    params: { plan: "SOLO" | "KITCHEN"; interval?: "month" | "year"; billingEmail: string; successUrl: string; cancelUrl: string },
  ) {
    const stripe = this.requireStripe(); // throws 503 if not configured

    const planDef = IBIRDOS_PLANS.find((p) => p.plan === params.plan);
    if (!planDef || planDef.comingSoon) {
      throw new BadRequestException({ code: "validation_failed", message: `Plan ${params.plan} not available` });
    }

    // Resolve Stripe price ID from env
    const priceIdEnvKey = params.plan === "SOLO" ? "STRIPE_PRICE_ID_SOLO" : "STRIPE_PRICE_ID_KITCHEN";
    const priceId = (env as any)[priceIdEnvKey] ?? env.STRIPE_PRICE_ID;
    if (!priceId) {
      throw new HttpException(
        { code: "billing_not_configured", message: `Add ${priceIdEnvKey} to .env to enable checkout for ${planDef.displayName}` },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const customer = await this.ensureCustomer(ctx, params.billingEmail);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      subscription_data: {
        trial_period_days: 14,
        metadata: { workspaceId: ctx.workspaceId, plan: params.plan },
      },
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      metadata: { workspaceId: ctx.workspaceId },
    });

    return { checkoutUrl: session.url, sessionId: session.id };
  }

  /** Get the customer portal URL for self-serve subscription management. */
  async createPortalSession(ctx: TenantContext, returnUrl: string) {
    const stripe = this.requireStripe();
    const customer = await prisma.billingCustomer.findUnique({
      where: { workspaceId: ctx.workspaceId },
    });
    if (!customer) throw new NotFoundException({ code: "not_found", message: "No billing customer found" });

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: returnUrl,
    });
    return { portalUrl: session.url };
  }

  /** Read current subscription state for the workspace. */
  async currentSubscription(workspaceId: string) {
    return prisma.subscription.findFirst({
      where: { workspaceId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"] } },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { billingEmail: true } } },
    });
  }

  async paymentHistory(workspaceId: string, limit = 50): Promise<any> {
    return prisma.paymentEvent.findMany({
      where: { workspaceId },
      orderBy: { receivedAt: "desc" },
      take: limit,
    });
  }

  /** Sync seat quantity to active memberships. Called by membership changes. */
  async syncSeatQuantity(workspaceId: string) {
    if (!this.stripe) return;
    const sub = await prisma.subscription.findFirst({
      where: { workspaceId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!sub) return;
    const count = await this.activeMemberCount(workspaceId);
    if (count === sub.seatQuantity) return;

    const stripeSub = await this.stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) return;
    await this.stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: itemId, quantity: count }],
      proration_behavior: "create_prorations",
    });
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { seatQuantity: count },
    });
    log.info({ workspaceId, oldCount: sub.seatQuantity, newCount: count }, "seat count synced to Stripe");
  }

  // -----------------------------------------------------------------
  // Webhook handler — the ONLY writer to subscription status fields
  // -----------------------------------------------------------------

  /**
   * Process a Stripe webhook. Signature verification done by the
   * controller before this is called.
   */
  async handleWebhookEvent(event: Stripe.Event) {
    // 1. Persist the event for replay/audit
    let customerId: string | null = null;
    const obj = event.data.object as any;
    if (typeof obj?.customer === "string") customerId = obj.customer;

    const customer = customerId
      ? await prisma.billingCustomer.findFirst({ where: { stripeCustomerId: customerId } })
      : null;

    if (customer) {
      await prisma.paymentEvent.upsert({
        where: { stripeEventId: event.id },
        create: {
          workspaceId: customer.workspaceId,
          customerId: customer.id,
          stripeEventType: event.type,
          stripeEventId: event.id,
          amountCents: obj?.amount_paid ?? obj?.amount ?? null,
          currency: obj?.currency?.toUpperCase() ?? null,
          payloadJson: event as any,
        },
        update: {}, // idempotent
      });
    }

    // 2. Dispatch by event type
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await this.upsertSubscription(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await this.cancelSubscription(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_succeeded":
        await this.markPaid(event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await this.markPastDue(event.data.object as Stripe.Invoice);
        break;
      default:
        log.debug({ type: event.type }, "webhook event acknowledged but not handled");
    }

    log.info({ type: event.type, id: event.id }, "webhook processed");
  }

  // -----------------------------------------------------------------
  // Private webhook handlers
  // -----------------------------------------------------------------

  private async upsertSubscription(stripeSub: Stripe.Subscription) {
    const workspaceId = stripeSub.metadata?.workspaceId;
    if (!workspaceId) {
      log.warn({ subId: stripeSub.id }, "subscription missing workspaceId metadata");
      return;
    }
    const customer = await prisma.billingCustomer.findFirst({
      where: { stripeCustomerId: stripeSub.customer as string },
    });
    if (!customer) return;

    const item = stripeSub.items.data[0];
    if (!item) return;

    const plan = ((stripeSub.metadata?.plan ?? "SOLO") as any);
    const status = stripeSub.status.toUpperCase().replace(/-/g, "_") as any;

    await prisma.subscription.upsert({
      where: { stripeSubscriptionId: stripeSub.id },
      create: {
        workspaceId,
        customerId: customer.id,
        stripeSubscriptionId: stripeSub.id,
        plan: plan as any, status,
        stripePriceId: item.price.id,
        unitAmountCents: item.price.unit_amount ?? 0,
        currency: item.price.currency.toUpperCase(),
        interval: item.price.recurring?.interval ?? "month",
        seatQuantity: item.quantity ?? 1,
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
        trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
        cancelAt: stripeSub.cancel_at ? new Date(stripeSub.cancel_at * 1000) : null,
        canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
      },
      update: {
        plan: plan as any, status,
        stripePriceId: item.price.id,
        unitAmountCents: item.price.unit_amount ?? 0,
        seatQuantity: item.quantity ?? 1,
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
        trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
        cancelAt: stripeSub.cancel_at ? new Date(stripeSub.cancel_at * 1000) : null,
        canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
      },
    });
  }

  private async cancelSubscription(stripeSub: Stripe.Subscription) {
    const existing = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!existing) return;
    await prisma.subscription.update({
      where: { id: existing.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
  }

  private async markPaid(invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;
    const sub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });
    if (sub && sub.status === "PAST_DUE") {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "ACTIVE" },
      });
    }
  }

  private async markPastDue(invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;
    const sub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });
    if (sub) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "PAST_DUE" },
      });
    }
  }

  private async activeMemberCount(workspaceId: string): Promise<number> {
    return prisma.membership.count({ where: { workspaceId, status: "ACTIVE" } });
  }
}
