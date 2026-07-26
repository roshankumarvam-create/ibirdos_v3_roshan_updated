import { describe, it, expect } from "vitest";
import { computeEventProfit } from "../src/money";

describe("computeEventProfit — P0-1: profit must subtract labor cost, not just food cost", () => {
  it("reproduces the client's exact cafe-71 numbers: $443.75 quote (incl. $100 labor), $203.07 food -> $140.68 profit, not $240.68", () => {
    // 50 portions x $6.25 = $312.50 subtotal, +$31.25 (10%) markup, +$100
    // labor charge = $443.75 quote total (revenue already includes the
    // billed labor, per BUG-3). Food cost $203.07.
    const result = computeEventProfit({
      revenueCents: 44375,
      foodCostCents: 20307,
      laborCostCents: 10000,
    });
    expect(result.profitCents).toBe(14068); // $140.68
    expect(result.marginPct).toBeCloseTo(31.70, 2);
  });

  it("non-zero labor: labor billed into revenue nets to zero profit impact when cost == charge, real profit comes only from the food-cost margin", () => {
    // Isolate the labor wash: revenue excluding labor (343.75) minus food
    // (203.07) should equal the full result, since billed labor ($100)
    // and labor cost ($100) are identical here and cancel out.
    const withLabor = computeEventProfit({ revenueCents: 44375, foodCostCents: 20307, laborCostCents: 10000 });
    const withoutLaborBothSides = 34375 - 20307; // revenue-excluding-labor minus food
    expect(withLabor.profitCents).toBe(withoutLaborBothSides);
  });

  it("zero labor: profit is simply revenue minus food cost", () => {
    const result = computeEventProfit({ revenueCents: 44375, foodCostCents: 20307, laborCostCents: 0 });
    expect(result.profitCents).toBe(24068); // $240.68 -- correct precisely BECAUSE there's no labor to subtract
    expect(result.marginPct).toBeCloseTo(54.24, 2);
  });

  it("labor billed above actual labor cost produces real extra profit (not netted to zero)", () => {
    // Billed $150 worth of labor into revenue but it only cost $100 to staff --
    // the $50 difference is real profit, must show up.
    const result = computeEventProfit({ revenueCents: 44425, foodCostCents: 20307, laborCostCents: 10000 });
    expect(result.profitCents).toBe(14118); // $140.68 + $0.50 extra from underspending the labor budget
  });

  it("otherCostCents (packaging/delivery) subtracts on top of food + labor when provided", () => {
    const result = computeEventProfit({
      revenueCents: 44375, foodCostCents: 20307, laborCostCents: 10000, otherCostCents: 2000,
    });
    expect(result.profitCents).toBe(12068); // $140.68 - $20.00
  });

  it("otherCostCents defaults to 0 when omitted -- no behavior change for existing callers", () => {
    const withDefault = computeEventProfit({ revenueCents: 44375, foodCostCents: 20307, laborCostCents: 10000 });
    const explicitZero = computeEventProfit({
      revenueCents: 44375, foodCostCents: 20307, laborCostCents: 10000, otherCostCents: 0,
    });
    expect(withDefault).toEqual(explicitZero);
  });

  it("returns null profit/margin when there's no quote yet (revenue null)", () => {
    expect(computeEventProfit({ revenueCents: null, foodCostCents: 20307, laborCostCents: 10000 }))
      .toEqual({ profitCents: null, marginPct: null });
  });

  it("returns null profit/margin when revenue is zero", () => {
    expect(computeEventProfit({ revenueCents: 0, foodCostCents: 20307, laborCostCents: 10000 }))
      .toEqual({ profitCents: null, marginPct: null });
  });

  it("negative profit (event costed more than it billed) is a real, unclamped number", () => {
    const result = computeEventProfit({ revenueCents: 10000, foodCostCents: 8000, laborCostCents: 5000 });
    expect(result.profitCents).toBe(-3000);
    expect(result.marginPct).toBeCloseTo(-30, 2);
  });
});
