import { describe, it, expect, vi, beforeEach } from "vitest";

// Live-backtested against real production (roshantest workspace, see
// FIX_LOG.md) that recordShortage()/listOutstandingForEvent()/resolveShortage()
// degrade gracefully when event_ingredient_shortages genuinely doesn't exist
// yet (Postgres 42P01) -- that path can't be exercised against a real table
// without running PENDING_MIGRATIONS.sql, which we were told not to do. This
// spec covers the row-shape/value correctness once the table DOES exist,
// using an in-memory fake table that mimics Postgres semantics, same pattern
// as quote-token.service.spec.ts used before its migration ran.

interface FakeRow {
  id: string; workspace_id: string; event_id: string; ingredient_id: string;
  ingredient_name: string; canonical_unit: string; preferred_display_unit: string | null;
  needed_canonical: number; consumed_canonical: number; short_canonical: number;
  est_cost_cents: number | null; source_task_id: string | null;
  resolved_at: Date | null; resolved_by_id: string | null; created_at: Date;
}

let fakeTable: FakeRow[] = [];
let fakeIngredients: Record<string, number> = {}; // ingredientId -> currentStockCanonical
let nextId = 0;
let tableMissing = false;

const missingTableError = () => {
  const err: any = new Error('Raw query failed. Code: `42P01`. Message: `relation "event_ingredient_shortages" does not exist`');
  return err;
};

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockExecuteRaw = vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
  if (tableMissing) throw missingTableError();
  const sql = strings.join("?");
  if (sql.includes("INSERT INTO event_ingredient_shortages")) {
    const [workspaceId, eventId, ingredientId, ingredientName, canonicalUnit, preferredDisplayUnit,
      neededCanonical, consumedCanonical, shortCanonical, estCostCents, sourceTaskId] = values;
    fakeTable.push({
      id: `row-${nextId++}`, workspace_id: workspaceId, event_id: eventId, ingredient_id: ingredientId,
      ingredient_name: ingredientName, canonical_unit: canonicalUnit, preferred_display_unit: preferredDisplayUnit,
      needed_canonical: neededCanonical, consumed_canonical: consumedCanonical, short_canonical: shortCanonical,
      est_cost_cents: estCostCents, source_task_id: sourceTaskId,
      resolved_at: null, resolved_by_id: null, created_at: new Date(),
    });
    return 1;
  }
  if (sql.includes("UPDATE event_ingredient_shortages")) {
    const [resolvedById, id, workspaceId] = values;
    const row = fakeTable.find((r) => r.id === id && r.workspace_id === workspaceId && r.resolved_at === null);
    if (!row) return 0;
    row.resolved_at = new Date();
    row.resolved_by_id = resolvedById;
    return 1;
  }
  throw new Error(`unexpected $executeRaw in test: ${sql}`);
});

const mockQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
  if (tableMissing) throw missingTableError();
  const sql = strings.join("?");
  if (sql.includes("FROM event_ingredient_shortages")) {
    const [workspaceId, eventId] = values;
    return fakeTable
      .filter((r) => r.workspace_id === workspaceId && r.event_id === eventId && r.resolved_at === null)
      .map((r) => ({
        id: r.id, ingredient_id: r.ingredient_id, ingredient_name: r.ingredient_name,
        canonical_unit: r.canonical_unit, preferred_display_unit: r.preferred_display_unit,
        needed_canonical: r.needed_canonical, consumed_canonical: r.consumed_canonical,
        short_canonical: r.short_canonical, est_cost_cents: r.est_cost_cents, created_at: r.created_at,
        current_stock_canonical: fakeIngredients[r.ingredient_id] ?? null,
      }));
  }
  if (sql.includes("information_schema.tables")) return [{ exists: !tableMissing }];
  throw new Error(`unexpected $queryRaw in test: ${sql}`);
});

vi.mock("@ibirdos/db", () => ({
  prisma: {
    $executeRaw: (strings: TemplateStringsArray, ...values: any[]) => mockExecuteRaw(strings, ...values),
    $queryRaw: (strings: TemplateStringsArray, ...values: any[]) => mockQueryRaw(strings, ...values),
  },
}));

import { recordShortage, listOutstandingForEvent, resolveShortage } from "./event-ingredient-shortage.service";

const ctx = (workspaceId: string) => ({ workspaceId, userId: "user-1", role: "OWNER" as const });

describe("event-ingredient-shortage.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeTable = [];
    fakeIngredients = {};
    nextId = 0;
    tableMissing = false;
  });

  it("records a shortage with the true outstanding amount (needed - consumed), not recomputed against current stock", async () => {
    // Mirrors the reported bug shape: needed 1000 lb (453592g), only 68.5 lb
    // (31071.052g) available -- outstanding is 931.5 lb (422520.948g).
    await recordShortage(ctx("ws-A"), {
      eventId: "event-1", ingredientId: "ing-1", ingredientName: "Beef Sirloin Tri Tip Pld Ch",
      canonicalUnit: "g", preferredDisplayUnit: "lb",
      neededCanonical: 453592, consumedCanonical: 31071.052, shortCanonical: 422520.948,
      estCostCents: 1058837, sourceTaskId: "task-1",
    });

    // Ingredient's current stock later drops to 0 (e.g. a second event also
    // draws it down) -- the recorded shortCanonical must NOT change.
    fakeIngredients["ing-1"] = 0;

    const rows = await listOutstandingForEvent(ctx("ws-A"), "event-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.shortCanonical).toBeCloseTo(422520.948, 3); // 931.5 lb, preserved
    expect(rows[0]!.neededCanonical).toBe(453592);
    expect(rows[0]!.consumedCanonical).toBeCloseTo(31071.052, 3);
    expect(rows[0]!.currentStockCanonical).toBe(0); // live join value, separate from shortCanonical
  });

  it("does not throw and returns null-shaped results when the table doesn't exist yet (migration not run)", async () => {
    tableMissing = true;
    await expect(recordShortage(ctx("ws-A"), {
      eventId: "event-1", ingredientId: "ing-1", ingredientName: "X", canonicalUnit: "g",
      preferredDisplayUnit: null, neededCanonical: 10, consumedCanonical: 0, shortCanonical: 10,
      estCostCents: null, sourceTaskId: null,
    })).resolves.toBeUndefined();

    const rows = await listOutstandingForEvent(ctx("ws-A"), "event-1");
    expect(rows).toEqual([]);

    const resolved = await resolveShortage(ctx("ws-A"), "row-0", "user-1");
    expect(resolved).toBe(false);
  });

  it("only lists unresolved rows for the requesting workspace and event", async () => {
    await recordShortage(ctx("ws-A"), {
      eventId: "event-1", ingredientId: "ing-1", ingredientName: "A", canonicalUnit: "g",
      preferredDisplayUnit: null, neededCanonical: 10, consumedCanonical: 0, shortCanonical: 10,
      estCostCents: null, sourceTaskId: null,
    });
    await recordShortage(ctx("ws-B"), {
      eventId: "event-1", ingredientId: "ing-2", ingredientName: "B (different tenant, same event id)", canonicalUnit: "g",
      preferredDisplayUnit: null, neededCanonical: 20, consumedCanonical: 0, shortCanonical: 20,
      estCostCents: null, sourceTaskId: null,
    });
    await recordShortage(ctx("ws-A"), {
      eventId: "event-2", ingredientId: "ing-3", ingredientName: "C (same workspace, different event)", canonicalUnit: "g",
      preferredDisplayUnit: null, neededCanonical: 30, consumedCanonical: 0, shortCanonical: 30,
      estCostCents: null, sourceTaskId: null,
    });

    const rows = await listOutstandingForEvent(ctx("ws-A"), "event-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ingredientName).toBe("A");
  });

  it("resolveShortage marks the row resolved and it disappears from the outstanding list; scoped to the requesting workspace", async () => {
    await recordShortage(ctx("ws-A"), {
      eventId: "event-1", ingredientId: "ing-1", ingredientName: "A", canonicalUnit: "g",
      preferredDisplayUnit: null, neededCanonical: 10, consumedCanonical: 0, shortCanonical: 10,
      estCostCents: null, sourceTaskId: null,
    });
    const before = await listOutstandingForEvent(ctx("ws-A"), "event-1");
    const rowId = before[0]!.id;

    // Wrong workspace cannot resolve another tenant's row.
    const wrongWs = await resolveShortage(ctx("ws-B"), rowId, "user-1");
    expect(wrongWs).toBe(false);

    const resolved = await resolveShortage(ctx("ws-A"), rowId, "user-1");
    expect(resolved).toBe(true);

    const after = await listOutstandingForEvent(ctx("ws-A"), "event-1");
    expect(after).toHaveLength(0);

    // Resolving again is a no-op, not an error.
    const resolvedAgain = await resolveShortage(ctx("ws-A"), rowId, "user-1");
    expect(resolvedAgain).toBe(false);
  });
});
