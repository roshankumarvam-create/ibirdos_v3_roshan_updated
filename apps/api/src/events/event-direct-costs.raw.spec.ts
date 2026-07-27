import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";

const mockQueryRaw = vi.fn();
const mockExecuteRaw = vi.fn();

vi.mock("@ibirdos/db", () => ({
  prisma: {
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
    $executeRaw: (...args: any[]) => mockExecuteRaw(...args),
  },
}));

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { getEventDirectCosts, getEventDirectCostsBulk, setEventDirectCosts } from "./event-direct-costs.raw";

describe("event-direct-costs.raw — #2 inert-until-migrated behavior", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("getEventDirectCosts", () => {
    it("returns the real values when the migration has run", async () => {
      mockQueryRaw.mockResolvedValue([{
        packaging_cost_cents: 500, delivery_cost_cents: 1500, equipment_cost_cents: 3000, other_direct_cost_cents: 200,
      }]);

      const result = await getEventDirectCosts("e1");

      expect(result).toEqual({
        packagingCostCents: 500, deliveryCostCents: 1500, equipmentCostCents: 3000, otherDirectCostCents: 200,
      });
    });

    it("treats null columns as 0, not null (safe to add directly into the profit formula)", async () => {
      mockQueryRaw.mockResolvedValue([{
        packaging_cost_cents: null, delivery_cost_cents: null, equipment_cost_cents: null, other_direct_cost_cents: null,
      }]);

      const result = await getEventDirectCosts("e1");

      expect(result).toEqual({ packagingCostCents: 0, deliveryCostCents: 0, equipmentCostCents: 0, otherDirectCostCents: 0 });
    });

    it("degrades to all-zero (does not throw) when the migration hasn't run yet", async () => {
      mockQueryRaw.mockRejectedValue(new Error('column "packaging_cost_cents" does not exist'));

      const result = await getEventDirectCosts("e1");

      expect(result).toEqual({ packagingCostCents: 0, deliveryCostCents: 0, equipmentCostCents: 0, otherDirectCostCents: 0 });
    });
  });

  describe("getEventDirectCostsBulk", () => {
    it("returns an empty map immediately for an empty id list, without querying", async () => {
      const result = await getEventDirectCostsBulk([]);
      expect(result.size).toBe(0);
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it("degrades to an empty map when the migration hasn't run yet", async () => {
      mockQueryRaw.mockRejectedValue(new Error("relation does not exist"));

      const result = await getEventDirectCostsBulk(["e1", "e2"]);

      expect(result.size).toBe(0);
    });
  });

  describe("setEventDirectCosts", () => {
    it("merges the patch onto current values and saves", async () => {
      mockQueryRaw.mockResolvedValue([{
        packaging_cost_cents: 500, delivery_cost_cents: 0, equipment_cost_cents: 0, other_direct_cost_cents: 0,
      }]);
      mockExecuteRaw.mockResolvedValue(1);

      await setEventDirectCosts("ws1", "e1", { deliveryCostCents: 1500 });

      const call = mockExecuteRaw.mock.calls[0]!;
      // Tagged-template raw call: values interpolated are in call[1..], packaging preserved at 500, delivery updated to 1500
      expect(call).toContain(500);
      expect(call).toContain(1500);
    });

    it("throws a clear BadRequestException (not a silent no-op) when the migration hasn't run yet", async () => {
      mockQueryRaw.mockResolvedValue([]);
      mockExecuteRaw.mockRejectedValue(new Error('column "packaging_cost_cents" does not exist'));

      await expect(setEventDirectCosts("ws1", "e1", { packagingCostCents: 1000 })).rejects.toThrow(BadRequestException);
    });

    it("throws not_found when the event doesn't exist in this workspace (0 rows affected)", async () => {
      mockQueryRaw.mockResolvedValue([]);
      mockExecuteRaw.mockResolvedValue(0);

      await expect(setEventDirectCosts("ws1", "nope", { packagingCostCents: 1000 })).rejects.toThrow(BadRequestException);
    });
  });
});
