import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

import { EventsService } from "../events/events.service";

const log = moduleLogger("CustomerOrderingService");

interface BuildQuoteInput {
  workspaceSlug: string;       // public route — slug instead of workspaceId
  customerEmail: string;
  customerName?: string;
  phone?: string;
  serviceType: "BUFFET" | "PLATED" | "FAMILY_STYLE" | "COCKTAIL" | "BOXED" | "DROP_OFF" | "OTHER";
  guestCount: number;
  scheduledFor: string;
  venueAddress?: string;
  items: Array<{ recipeId: string; portions: number; portionSize?: "REGULAR" | "LARGE" }>;
  addons?: { utensils?: boolean; staffHours?: number; deliveryMiles?: number };
  notes?: string;
}

@Injectable()
export class CustomerOrderingService {
  constructor(private readonly events: EventsService) {}

  /**
   * Public menu — recipes flagged ACTIVE with a sale price.
   * Tenant scoped by slug rather than session (this is a public surface).
   */
  async publicMenu(workspaceSlug: string) {
    const ws = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug }, select: { id: true, name: true, status: true, deletedAt: true },
    });
    if (!ws || ws.deletedAt || ws.status !== "ACTIVE") {
      throw new NotFoundException({ code: "not_found", message: "Menu not available" });
    }
    const recipes = await prisma.recipe.findMany({
      where: { workspaceId: ws.id, status: "ACTIVE", deletedAt: null, salePriceCents: { not: null } },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, category: true, salePriceCents: true,
        portionsYielded: true, prepTimeMin: true, cookTimeMin: true, photoUrl: true,
      },
    });
    return { workspace: { name: ws.name, slug: workspaceSlug }, items: recipes };
  }

  /**
   * Build a quote (no payment yet). Returns the order with computed totals.
   * No auth required — public endpoint.
   */
  async buildQuote(input: BuildQuoteInput) {
    const ws = await prisma.workspace.findUnique({
      where: { slug: input.workspaceSlug }, select: { id: true, deletedAt: true, status: true },
    });
    if (!ws || ws.deletedAt || ws.status !== "ACTIVE") {
      throw new NotFoundException({ code: "not_found", message: "Workspace not available" });
    }

    // Validate recipes exist and are active
    const recipeIds = input.items.map((i) => i.recipeId);
    const recipes = await prisma.recipe.findMany({
      where: { id: { in: recipeIds }, workspaceId: ws.id, status: "ACTIVE", deletedAt: null },
      select: { id: true, name: true, salePriceCents: true },
    });
    if (recipes.length !== recipeIds.length) {
      throw new BadRequestException({ code: "validation_failed", message: "One or more items are not available" });
    }
    const priceById = new Map(recipes.map((r) => [r.id, r.salePriceCents ?? 0]));

    // Compute pricing
    let subtotalCents = 0;
    for (const item of input.items) {
      const unit = priceById.get(item.recipeId) ?? 0;
      const sizeMultiplier = item.portionSize === "LARGE" ? 1.5 : 1.0;
      subtotalCents += Math.round(unit * item.portions * sizeMultiplier);
    }
    let addonsCents = 0;
    if (input.addons?.utensils) addonsCents += input.guestCount * 25;
    if (input.addons?.staffHours) addonsCents += input.addons.staffHours * 3500;    // $35/hr default
    if (input.addons?.deliveryMiles) addonsCents += input.addons.deliveryMiles * 175; // $1.75/mile
    const taxCents = Math.round((subtotalCents + addonsCents) * 0.0875);
    const totalCents = subtotalCents + addonsCents + taxCents;

    // Upsert customer
    const customer = await prisma.customerProfile.upsert({
      where: { workspaceId_email: { workspaceId: ws.id, email: input.customerEmail } },
      create: {
        workspaceId: ws.id, email: input.customerEmail,
        fullName: input.customerName ?? null, phone: input.phone ?? null,
      },
      update: {
        fullName: input.customerName ?? undefined,
        phone: input.phone ?? undefined,
      },
    });

    const order = await prisma.customerOrder.create({
      data: {
        workspaceId: ws.id, customerId: customer.id, status: "DRAFT",
        itemsJson: input.items as any,
        addonsJson: input.addons ?? null,
        serviceType: input.serviceType as any,
        guestCount: input.guestCount,
        scheduledFor: new Date(input.scheduledFor),
        venueAddress: input.venueAddress ?? null,
        subtotalCents, addonsCents, taxCents, totalCents,
        notes: input.notes ?? null,
      },
    });

    log.info({ orderId: order.id, totalCents }, "quote created");
    return { orderId: order.id, subtotalCents, addonsCents, taxCents, totalCents };
  }

  /**
   * Initiate Stripe Checkout. Returns checkout URL. Webhook flips
   * order to PAID and triggers event creation.
   *
   * Phase 2 stub: returns placeholder URL when STRIPE_REQUIRED=false
   * or no key configured. Full Stripe wiring in production hardening.
   */
  async checkout(orderId: string): Promise<{ checkoutUrl: string }> {
    const order = await prisma.customerOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException({ code: "not_found", message: "Order not found" });
    if (order.status !== "DRAFT") {
      throw new BadRequestException({ code: "validation_failed", message: `Cannot checkout from ${order.status}` });
    }

    let checkoutUrl: string;
    if (!env.STRIPE_SECRET_KEY) {
      // Dev fallback: synthetic success URL that the webhook simulator hits
      checkoutUrl = `${env.WEB_URL}/order/${orderId}/dev-confirm`;
    } else {
      // Real Stripe checkout would go here. Skeleton:
      // const stripe = new Stripe(env.STRIPE_SECRET_KEY);
      // const session = await stripe.checkout.sessions.create({ ... });
      // checkoutUrl = session.url!;
      checkoutUrl = `${env.WEB_URL}/order/${orderId}/dev-confirm`;
    }

    await prisma.customerOrder.update({
      where: { id: orderId },
      data: { status: "AWAITING_PAYMENT" },
    });
    return { checkoutUrl };
  }

  /**
   * Webhook handler (or dev confirm) — marks paid + creates Event.
   * Runs as a system action; no TenantContext yet — derives workspaceId
   * from the order itself.
   */
  async confirmPayment(orderId: string, params: { stripePaymentIntentId?: string }) {
    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId }, include: { customer: true },
    });
    if (!order) throw new NotFoundException({ code: "not_found", message: "Order not found" });
    if (order.status === "PAID") return order; // idempotent

    // Synthesize a system TenantContext for downstream services
    const ctx: TenantContext = {
      userId: "system",
      workspaceId: order.workspaceId,
      role: "OWNER", // system action; bypasses RBAC because we don't go through the controller layer
    };

    // Create event from order
    const event = await this.events.create(ctx, {
      name: `${order.customer.fullName ?? order.customer.email} — ${order.serviceType}`,
      status: "CONFIRMED",
      serviceType: order.serviceType,
      customerName: order.customer.fullName,
      customerContact: order.customer.email,
      venueAddress: order.venueAddress,
      startsAt: order.scheduledFor.toISOString(),
      guestCount: order.guestCount,
      quotedPriceCents: order.totalCents,
      notes: `Auto-created from customer order ${orderId}`,
    });

    // Add menu items from the order's itemsJson
    const items = order.itemsJson as Array<{ recipeId: string; portions: number }>;
    for (const item of items) {
      await this.events.addMenuItem(ctx, event.id, {
        recipeId: item.recipeId, portions: item.portions,
      }).catch((err) => log.warn({ orderId, recipeId: item.recipeId, err: err.message }, "menu item add failed"));
    }

    const updated = await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        stripePaymentIntentId: params.stripePaymentIntentId ?? null,
        createdEventId: event.id,
      },
    });

    await writeAudit(ctx, {
      action: "customer_order.paid", entityType: "CustomerOrder", entityId: orderId,
      metadata: { totalCents: order.totalCents, eventId: event.id },
    });
    log.info({ orderId, eventId: event.id, totalCents: order.totalCents }, "customer order paid and event created");
    return updated;
  }

  async getOrder(orderId: string) {
    const o = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: { customer: { select: { email: true, fullName: true } } },
    });
    if (!o) throw new NotFoundException({ code: "not_found", message: "Order not found" });
    return o;
  }
}
