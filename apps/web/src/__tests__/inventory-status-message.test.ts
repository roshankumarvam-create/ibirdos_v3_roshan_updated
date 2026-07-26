import { describe, it, expect } from "vitest";
import { inventoryStatusMessage } from "../lib/inventory-status";

describe("inventoryStatusMessage — #17: don't claim OK when thresholds aren't set", () => {
  it("prioritizes real alerts over the threshold-coverage message", () => {
    expect(inventoryStatusMessage(3, 5)).toBe("3 items need attention");
    expect(inventoryStatusMessage(1, 0)).toBe("1 item need attention");
  });

  it("shows the threshold-coverage caveat instead of a false OK claim when nothing can be checked", () => {
    expect(inventoryStatusMessage(0, 4)).toBe("4 ingredients have no threshold set — can't verify");
    expect(inventoryStatusMessage(0, 1)).toBe("1 ingredient have no threshold set — can't verify");
  });

  it("only claims OK when there are zero alerts AND every ingredient has a threshold", () => {
    expect(inventoryStatusMessage(0, 0)).toBe("all stock levels OK");
  });
});
