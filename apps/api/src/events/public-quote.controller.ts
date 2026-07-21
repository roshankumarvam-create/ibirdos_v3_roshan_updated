// =====================================================================
// apps/api/src/events/public-quote.controller.ts
// =====================================================================
// BUG 5 -- the public quote page's API. NO TenantContext, NO auth cookie
// -- this is deliberately reachable by anyone with the link, which is
// the whole point (a client with no account needs to see their quote).
// Security rests entirely on: (a) the token being unguessable (256-bit
// crypto-random, see quote-token.service.ts), (b) every lookup here
// being scoped to the ONE event that token's exact-equality match
// resolves to -- there is no path in this controller that accepts a
// workspace id, event id, or any other identifier from the request; the
// token is the only input, and it can only ever resolve to one row.
// =====================================================================

import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { prisma } from "@ibirdos/db";
import { getWorkspaceTimeZone } from "@ibirdos/types";
import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/guards/rate-limit.guard";
import { resolveEventByQuoteToken } from "./quote-token.service";
import { computeLiveQuoteTotalCents } from "./events.service";

@Controller("public/quote")
export class PublicQuoteController {
  @Get(":token")
  @Public()
  @RateLimit({ limit: 30, windowSec: 60 })
  async getQuote(@Param("token") token: string) {
    const event = await resolveEventByQuoteToken(token);
    if (!event) {
      throw new NotFoundException({ code: "not_found", message: "Quote link not found or no longer valid." });
    }

    // Dead-link on cancel: a cancelled event's quote is no longer a live
    // offer, but the link shouldn't leak that distinction beyond "not
    // available" (same 404 shape as an unrecognized token).
    if (event.status === "CANCELLED") {
      throw new NotFoundException({ code: "not_found", message: "Quote link not found or no longer valid." });
    }

    // Every query below is scoped by event.id / event.workspaceId, both
    // of which came from the already-resolved single-event lookup above
    // (never from request input) -- structurally impossible to reach a
    // different event or workspace's data through this endpoint.
    const [menuItems, workspace] = await Promise.all([
      prisma.eventMenuItem.findMany({
        where: { eventId: event.id, workspaceId: event.workspaceId },
        orderBy: { displayOrder: "asc" },
        select: {
          portions: true,
          unitPriceCentsOverride: true,
          unitPriceCentsAtAdd: true,
          recipe: { select: { name: true, salePriceCents: true } },
        },
      }),
      prisma.workspace.findUnique({ where: { id: event.workspaceId }, select: { name: true, settings: true } }),
    ]);

    const menuLines = menuItems.map((mi) => {
      const unitPriceCents = mi.unitPriceCentsOverride ?? mi.unitPriceCentsAtAdd ?? mi.recipe.salePriceCents ?? 0;
      return {
        recipeName: mi.recipe.name,
        portions: mi.portions,
        unitPriceCents,
        lineTotalCents: unitPriceCents * mi.portions,
      };
    });

    const subtotalCents = menuLines.reduce((sum, l) => sum + l.lineTotalCents, 0);
    const markupPct = Number(event.markupPct ?? 0);
    const markupAmountCents = Math.round(subtotalCents * (markupPct / 100));

    // A frozen/overridden total (already paid, or manually adjusted) is
    // authoritative once it exists; otherwise show the live computed
    // total (same formula, labor included per BUG 3).
    const frozenTotal = event.quotedTotalOverrideCents ?? event.quotedPriceCents;
    const totalCents = frozenTotal ?? computeLiveQuoteTotalCents(
      menuItems as any,
      Number(event.markupPct),
      event.laborTotalCents,
    );

    return {
      data: {
        eventName: event.name,
        businessName: workspace?.name ?? null,
        workspaceTimeZone: getWorkspaceTimeZone(workspace?.settings),
        venueAddress: event.venueAddress,
        customerName: event.customerName,
        startsAt: event.startsAt,
        serviceType: event.serviceType,
        menuLines,
        subtotalCents,
        markupPct,
        markupAmountCents,
        laborTotalCents: event.laborTotalCents,
        totalCents,
      },
      error: null,
    };
  }
}
