import { describe, it, expect, vi, beforeEach } from "vitest";

// NOTE: this file has the same pre-existing @ibirdos/config vitest
// resolution gap as events.service.spec.ts / recipes.service.ts
// (workspaces.service.ts imports `env` from @ibirdos/config directly).
// Confirmed via `git stash` this predates all work in this batch --
// verified via `tsc --noEmit` clean + manual review instead, same
// workaround used throughout this engagement.

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockWorkspaceFindFirst = vi.fn();
const mockWorkspaceUpdate = vi.fn();
const mockWriteAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@ibirdos/db", () => ({
  prisma: {
    workspace: {
      findFirst: (...args: any[]) => mockWorkspaceFindFirst(...args),
      update: (...args: any[]) => mockWorkspaceUpdate(...args),
    },
  },
  writeAudit: (...args: any[]) => mockWriteAudit(...args),
}));

import { WorkspacesService } from "./workspaces.service";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };

describe("WorkspacesService.updateSettings — #3: workspace-wide target food-cost %", () => {
  let svc: WorkspacesService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new WorkspacesService({} as any, {} as any);
  });

  it("merges targetFoodCostPct into the existing settings JSON blob without a schema/migration", async () => {
    mockWorkspaceFindFirst.mockResolvedValue({ id: "ws1", settings: { timezone: "America/Los_Angeles" } });
    mockWorkspaceUpdate.mockResolvedValue({ id: "ws1", settings: { timezone: "America/Los_Angeles", targetFoodCostPct: 30 } });

    await svc.updateSettings(ctx, "cafe-71", { targetFoodCostPct: 30 } as any);

    const updateCall = mockWorkspaceUpdate.mock.calls[0]![0];
    expect(updateCall.data.settings).toEqual({ timezone: "America/Los_Angeles", targetFoodCostPct: 30 });
  });

  it("preserves other settings keys (e.g. timezone) when only targetFoodCostPct is patched", async () => {
    mockWorkspaceFindFirst.mockResolvedValue({ id: "ws1", settings: { timezone: "America/New_York" } });
    mockWorkspaceUpdate.mockResolvedValue({});

    await svc.updateSettings(ctx, "cafe-71", { targetFoodCostPct: 25 } as any);

    const updateCall = mockWorkspaceUpdate.mock.calls[0]![0];
    expect(updateCall.data.settings.timezone).toBe("America/New_York");
  });

  it("clearing the target (explicit null) actually stores null, not undefined/dropped", async () => {
    mockWorkspaceFindFirst.mockResolvedValue({ id: "ws1", settings: { timezone: "UTC", targetFoodCostPct: 30 } });
    mockWorkspaceUpdate.mockResolvedValue({});

    await svc.updateSettings(ctx, "cafe-71", { targetFoodCostPct: null } as any);

    const updateCall = mockWorkspaceUpdate.mock.calls[0]![0];
    expect(updateCall.data.settings.targetFoodCostPct).toBeNull();
  });

  it("omitting targetFoodCostPct entirely leaves an existing value untouched", async () => {
    mockWorkspaceFindFirst.mockResolvedValue({ id: "ws1", settings: { timezone: "UTC", targetFoodCostPct: 28 } });
    mockWorkspaceUpdate.mockResolvedValue({});

    await svc.updateSettings(ctx, "cafe-71", { timezone: "America/Chicago" } as any);

    const updateCall = mockWorkspaceUpdate.mock.calls[0]![0];
    expect(updateCall.data.settings.targetFoodCostPct).toBe(28);
    expect(updateCall.data.settings.timezone).toBe("America/Chicago");
  });
});
