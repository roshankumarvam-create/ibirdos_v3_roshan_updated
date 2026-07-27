// =====================================================================
// apps/api/src/events/event-direct-costs.raw.ts
// =====================================================================
// #2: per-event packaging / delivery / equipment / other direct cost
// inputs. Additive columns (packaging_cost_cents, delivery_cost_cents,
// equipment_cost_cents, other_direct_cost_cents on `events`) are NOT
// yet in schema.prisma or run against production -- see
// PENDING_MIGRATIONS.sql. This is the ONLY file that touches those four
// columns, via raw SQL, following the same graceful-degradation pattern
// as quote-token.service.ts's pre-migration version: reads degrade to
// all-zero (the event profit formula already treats these as 0 by
// default, so this is a true no-op, not a wrong number), writes throw a
// clear, caught error instead of silently discarding a cost the
// operator explicitly typed in.
// =====================================================================

import { BadRequestException } from "@nestjs/common";
import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("EventDirectCostsRaw");

export interface EventDirectCosts {
  packagingCostCents: number;
  deliveryCostCents: number;
  equipmentCostCents: number;
  otherDirectCostCents: number;
}

const ZERO: EventDirectCosts = {
  packagingCostCents: 0, deliveryCostCents: 0, equipmentCostCents: 0, otherDirectCostCents: 0,
};

export async function getEventDirectCosts(eventId: string): Promise<EventDirectCosts> {
  try {
    const rows = await prisma.$queryRaw<Array<{
      packaging_cost_cents: number | null;
      delivery_cost_cents: number | null;
      equipment_cost_cents: number | null;
      other_direct_cost_cents: number | null;
    }>>`
      SELECT packaging_cost_cents, delivery_cost_cents, equipment_cost_cents, other_direct_cost_cents
      FROM events WHERE id = ${eventId} LIMIT 1
    `;
    if (rows.length === 0) return ZERO;
    const r = rows[0]!;
    return {
      packagingCostCents: r.packaging_cost_cents ?? 0,
      deliveryCostCents: r.delivery_cost_cents ?? 0,
      equipmentCostCents: r.equipment_cost_cents ?? 0,
      otherDirectCostCents: r.other_direct_cost_cents ?? 0,
    };
  } catch (err: any) {
    log.warn({ eventId, err: err.message }, "event direct costs unavailable — migration likely not run yet");
    return ZERO;
  }
}

/** Bulk variant for list views — one query for many events, same degrade-to-empty-map behavior. */
export async function getEventDirectCostsBulk(eventIds: string[]): Promise<Map<string, EventDirectCosts>> {
  if (eventIds.length === 0) return new Map();
  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string;
      packaging_cost_cents: number | null;
      delivery_cost_cents: number | null;
      equipment_cost_cents: number | null;
      other_direct_cost_cents: number | null;
    }>>`
      SELECT id, packaging_cost_cents, delivery_cost_cents, equipment_cost_cents, other_direct_cost_cents
      FROM events WHERE id = ANY(${eventIds})
    `;
    return new Map(rows.map((r) => [r.id, {
      packagingCostCents: r.packaging_cost_cents ?? 0,
      deliveryCostCents: r.delivery_cost_cents ?? 0,
      equipmentCostCents: r.equipment_cost_cents ?? 0,
      otherDirectCostCents: r.other_direct_cost_cents ?? 0,
    }]));
  } catch (err: any) {
    log.warn({ err: err.message }, "bulk event direct costs unavailable — migration likely not run yet");
    return new Map();
  }
}

export async function setEventDirectCosts(
  workspaceId: string,
  eventId: string,
  patch: Partial<EventDirectCosts>,
): Promise<void> {
  try {
    const current = await getEventDirectCosts(eventId);
    const next: EventDirectCosts = { ...current, ...patch };
    const result = await prisma.$executeRaw`
      UPDATE events SET
        packaging_cost_cents = ${next.packagingCostCents},
        delivery_cost_cents = ${next.deliveryCostCents},
        equipment_cost_cents = ${next.equipmentCostCents},
        other_direct_cost_cents = ${next.otherDirectCostCents}
      WHERE id = ${eventId} AND workspace_id = ${workspaceId}
    `;
    if (result === 0) {
      throw new BadRequestException({ code: "not_found", message: "Event not found" });
    }
  } catch (err: any) {
    if (err instanceof BadRequestException) throw err;
    log.warn({ eventId, err: err.message }, "failed to save event direct costs — migration likely not run yet");
    throw new BadRequestException({
      code: "feature_not_enabled",
      message: "Packaging/delivery/equipment/other cost tracking isn't enabled on this workspace yet (pending database migration).",
    });
  }
}
