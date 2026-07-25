// =====================================================================
// P0-2 — duplicate inventory consumption regression test.
// Previously verified only via a manual, one-off `tsx` backtest script
// against production/roshantest (see FIX_LOG.md) — never committed as an
// automated test. This proves the actual fix: every menu item generates
// BOTH a PREP and a SERVICE kitchen task for the same recipe (see
// events.service.ts), and completing both used to deduct the same
// ingredients twice (confirmed live: Tofu/Asparagus, two CONSUME rows,
// 39 seconds apart). The fix is the `task.taskType !== "SERVICE"` guard
// in `updateTask()` plus the per-task `hasTransactionFor()` idempotency
// check inside `consumeIngredients()` — this test exercises both.
// =====================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockKitchenTaskFindFirst = vi.fn();
const mockKitchenTaskUpdate = vi.fn();
const mockRecipeFindFirst = vi.fn();
const mockEventFindMany = vi.fn().mockResolvedValue([]);
const mockUserFindMany = vi.fn().mockResolvedValue([]);
const mockWriteAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@ibirdos/db", () => ({
  prisma: {
    kitchenTask: {
      findFirst: (...a: any[]) => mockKitchenTaskFindFirst(...a),
      update: (...a: any[]) => mockKitchenTaskUpdate(...a),
    },
    recipe: { findFirst: (...a: any[]) => mockRecipeFindFirst(...a) },
    event: {
      findMany: (...a: any[]) => mockEventFindMany(...a),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    user: { findMany: (...a: any[]) => mockUserFindMany(...a) },
    ingredient: { findFirst: vi.fn().mockResolvedValue(null) },
  },
  writeAudit: (...a: any[]) => mockWriteAudit(...a),
}));

// Real module hits `$queryRaw`/`$executeRaw` against an unmigrated column
// (see kitchen-task-due.service.ts's own header comment) — irrelevant to
// this test, and mocking it out avoids needing to fake raw-SQL results too.
vi.mock("./kitchen-task-due.service", () => ({
  getDueAtMap: vi.fn().mockResolvedValue(new Map()),
  setDueAt: vi.fn().mockResolvedValue(true),
}));

vi.mock("../events/event-ingredient-shortage.service", () => ({
  recordShortage: vi.fn().mockResolvedValue(undefined),
}));

import { KitchenService } from "./kitchen.service";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };
const mockRedis = { publish: vi.fn().mockResolvedValue(1) } as any;

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    workspaceId: "ws1",
    eventId: null,
    recipeId: "rec-1",
    targetPortions: 10,
    taskType: "PREP",
    status: "PENDING",
    assignedUserId: null,
    startedAt: null,
    completedAt: null,
    blockReason: null,
    ...overrides,
  };
}

const testRecipe = {
  id: "rec-1",
  name: "Grilled Tofu & Asparagus Bowl",
  portionsYielded: 10,
  ingredients: [
    {
      quantity: "100",
      unit: "g",
      yieldPctOverride: null,
      ingredient: {
        id: "ing-1",
        name: "Tofu, Extra Firm Org/C",
        dimension: "MASS",
        densityGPerMl: null,
        canonicalUnit: "g",
      },
    },
  ],
};

describe("KitchenService.updateTask — P0-2 duplicate inventory consumption", () => {
  let svc: KitchenService;
  let mockInventory: { hasTransactionFor: ReturnType<typeof vi.fn>; recordTransaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInventory = {
      hasTransactionFor: vi.fn().mockResolvedValue(false),
      recordTransaction: vi.fn().mockResolvedValue({}),
    };
    svc = new KitchenService(mockRedis, mockInventory as any);
    mockRecipeFindFirst.mockResolvedValue(testRecipe as any);
    mockKitchenTaskUpdate.mockImplementation((args: any) => ({ ...args.data, id: "updated" }));
    mockEventFindMany.mockResolvedValue([]);
    mockUserFindMany.mockResolvedValue([]);
  });

  it("marking a PREP task DONE consumes inventory exactly once", async () => {
    mockKitchenTaskFindFirst.mockResolvedValue(makeTask({ id: "task-prep", taskType: "PREP" }));

    await svc.updateTask(ctx, "task-prep", { status: "DONE" });

    expect(mockInventory.recordTransaction).toHaveBeenCalledTimes(1);
    expect(mockInventory.recordTransaction).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        ingredientId: "ing-1",
        kind: "CONSUME",
        sourceKind: "KitchenTask",
        sourceRef: "task-prep",
      }),
    );
  });

  it("marking the paired SERVICE task DONE for the same recipe does NOT consume again — the actual reported bug", async () => {
    // Reproduces the real production incident: same menu item generates a
    // PREP task and a SERVICE task, both for the same recipeId, both
    // eventually marked DONE (the normal, expected workflow — not an edge
    // case). Before the fix, both independently triggered
    // consumeIngredients() and every ingredient was deducted twice.
    mockKitchenTaskFindFirst.mockResolvedValueOnce(makeTask({ id: "task-prep", taskType: "PREP" }));
    await svc.updateTask(ctx, "task-prep", { status: "DONE" });

    mockKitchenTaskFindFirst.mockResolvedValueOnce(makeTask({ id: "task-service", taskType: "SERVICE" }));
    await svc.updateTask(ctx, "task-service", { status: "DONE" });

    // Exactly one CONSUME across both PREP and SERVICE, not two.
    expect(mockInventory.recordTransaction).toHaveBeenCalledTimes(1);
  });

  it("re-marking a reverted PREP task DONE again does not double-consume (per-task idempotency guard)", async () => {
    // Task was DONE (consumed once), then reverted to PENDING, now marked
    // DONE again — hasTransactionFor reports the earlier CONSUME still
    // exists, so this must skip, not deduct a second time.
    mockKitchenTaskFindFirst.mockResolvedValue(makeTask({ id: "task-prep", taskType: "PREP", status: "PENDING" }));
    mockInventory.hasTransactionFor.mockResolvedValue(true);

    await svc.updateTask(ctx, "task-prep", { status: "DONE" });

    expect(mockInventory.recordTransaction).not.toHaveBeenCalled();
  });

  it("SERVICE task DONE never even attempts consumption, regardless of idempotency state", async () => {
    // Isolates the taskType guard itself (not just the net effect above) —
    // a SERVICE task should never reach consumeIngredients()'s guards at
    // all, so hasTransactionFor should never even be called for it.
    mockKitchenTaskFindFirst.mockResolvedValue(makeTask({ id: "task-service", taskType: "SERVICE" }));

    await svc.updateTask(ctx, "task-service", { status: "DONE" });

    expect(mockInventory.hasTransactionFor).not.toHaveBeenCalled();
    expect(mockInventory.recordTransaction).not.toHaveBeenCalled();
  });
});
