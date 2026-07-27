import { describe, it, expect } from "vitest";
import {
  computeEventProfit, getMarginWarningLevel,
  MARGIN_WARNING_THRESHOLD_PCT, MARGIN_CRITICAL_THRESHOLD_PCT,
} from "../src/money";

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

  it("#2 fix: packaging/delivery/equipment/other all subtract together, matching profit = revenue - food - labor - packaging - delivery - equipment - other", () => {
    const result = computeEventProfit({
      revenueCents: 44375, foodCostCents: 20307, laborCostCents: 10000,
      packagingCostCents: 500, deliveryCostCents: 1500, equipmentCostCents: 3000, otherCostCents: 200,
    });
    // $140.68 base profit - ($5 + $15 + $30 + $2) = $140.68 - $52.00 = $88.68
    expect(result.profitCents).toBe(8868);
  });

  it("#2 fix: all four direct-cost fields default to 0 independently -- omitting any subset changes nothing else", () => {
    const onlyPackaging = computeEventProfit({
      revenueCents: 44375, foodCostCents: 20307, laborCostCents: 10000, packagingCostCents: 1000,
    });
    expect(onlyPackaging.profitCents).toBe(13068); // $140.68 - $10.00
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

describe("getMarginWarningLevel — issue #2: below-target-margin warning, never built before this", () => {
  it("reproduces the client's reported numbers: ~59% and ~65% food cost (no labor) both fire a warning", () => {
    // 59% food cost -> 41% margin -> below the 45% warning threshold.
    const at59 = computeEventProfit({ revenueCents: 10000, foodCostCents: 5900, laborCostCents: 0 });
    expect(at59.marginPct).toBeCloseTo(41, 2);
    expect(getMarginWarningLevel(at59.marginPct)).toBe("warning");

    // 65% food cost -> 35% margin -> also below 45%.
    const at65 = computeEventProfit({ revenueCents: 10000, foodCostCents: 6500, laborCostCents: 0 });
    expect(at65.marginPct).toBeCloseTo(35, 2);
    expect(getMarginWarningLevel(at65.marginPct)).toBe("warning");
  });

  it("threshold boundary: exactly 45% is NOT a warning (strictly below only)", () => {
    expect(getMarginWarningLevel(MARGIN_WARNING_THRESHOLD_PCT)).toBe("none");
    expect(getMarginWarningLevel(45)).toBe("none");
  });

  it("threshold boundary: just under 45% IS a warning", () => {
    expect(getMarginWarningLevel(44.99)).toBe("warning");
  });

  it("threshold boundary: exactly 25% is warning, not critical (strictly below only)", () => {
    expect(getMarginWarningLevel(MARGIN_CRITICAL_THRESHOLD_PCT)).toBe("warning");
    expect(getMarginWarningLevel(25)).toBe("warning");
  });

  it("threshold boundary: just under 25% IS critical", () => {
    expect(getMarginWarningLevel(24.99)).toBe("critical");
  });

  it("healthy margin (>= 45%) shows no warning", () => {
    expect(getMarginWarningLevel(50)).toBe("none");
    expect(getMarginWarningLevel(100)).toBe("none");
  });

  it("negative margin is critical", () => {
    expect(getMarginWarningLevel(-10)).toBe("critical");
  });

  it("null/undefined margin (no quote yet) shows no warning -- nothing to warn about", () => {
    expect(getMarginWarningLevel(null)).toBe("none");
    expect(getMarginWarningLevel(undefined)).toBe("none");
  });
});
