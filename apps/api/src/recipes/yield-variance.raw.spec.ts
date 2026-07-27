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

import { getYieldVarianceReason, setYieldVarianceReason } from "./yield-variance.raw";

describe("yield-variance.raw — #20 inert-until-migrated behavior", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("getYieldVarianceReason", () => {
    it("returns the reason/note when the migration has run and a reason is recorded", async () => {
      mockQueryRaw.mockResolvedValue([{ yield_variance_reason: "TRIMMING_LOSS", yield_variance_reason_note: "Portioned after trim" }]);

      const result = await getYieldVarianceReason("r1");

      expect(result).toEqual({ reason: "TRIMMING_LOSS", note: "Portioned after trim" });
    });

    it("returns null when no reason has been recorded yet (column exists, value is null)", async () => {
      mockQueryRaw.mockResolvedValue([{ yield_variance_reason: null, yield_variance_reason_note: null }]);

      const result = await getYieldVarianceReason("r1");

      expect(result).toBeNull();
    });

    it("degrades to null (does not throw) when the migration hasn't run yet", async () => {
      mockQueryRaw.mockRejectedValue(new Error('column "yield_variance_reason" does not exist'));

      const result = await getYieldVarianceReason("r1");

      expect(result).toBeNull();
    });
  });

  describe("setYieldVarianceReason", () => {
    it("saves successfully when the migration has run", async () => {
      mockExecuteRaw.mockResolvedValue(1);

      await expect(setYieldVarianceReason("ws1", "r1", "MOISTURE_CHANGE", "steamed")).resolves.toBeUndefined();
    });

    it("throws a clear BadRequestException (not a silent no-op) when the migration hasn't run yet", async () => {
      mockExecuteRaw.mockRejectedValue(new Error('column "yield_variance_reason" does not exist'));

      await expect(setYieldVarianceReason("ws1", "r1", "OTHER", null)).rejects.toThrow(BadRequestException);
    });

    it("throws not_found when the recipe doesn't exist in this workspace (0 rows affected)", async () => {
      mockExecuteRaw.mockResolvedValue(0);

      await expect(setYieldVarianceReason("ws1", "nope", "OTHER", null)).rejects.toThrow(BadRequestException);
    });
  });
});
