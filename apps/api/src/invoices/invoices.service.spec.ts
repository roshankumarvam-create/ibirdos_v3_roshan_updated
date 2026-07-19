import { describe, it, expect } from "vitest";

import { sumInvoiceLineCents, reconcileInvoiceTotal, INVOICE_RECONCILE_TOLERANCE_CENTS } from "./invoices.service";

describe("sumInvoiceLineCents", () => {
  it("sums extendedPriceCents across non-excluded lines", () => {
    const total = sumInvoiceLineCents([
      { extendedPriceCents: 1000, excluded: false },
      { extendedPriceCents: 2550, excluded: false },
    ]);
    expect(total).toBe(3550);
  });

  it("skips excluded lines", () => {
    const total = sumInvoiceLineCents([
      { extendedPriceCents: 1000, excluded: false },
      { extendedPriceCents: 9999, excluded: true },
    ]);
    expect(total).toBe(1000);
  });

  it("returns 0 for no lines", () => {
    expect(sumInvoiceLineCents([])).toBe(0);
  });
});

describe("reconcileInvoiceTotal — P0-3: invoices saved with $0.00 totals despite having lines", () => {
  it("fills a blank (null) total from subtotal + tax instead of leaving it blank", () => {
    const result = reconcileInvoiceTotal(null, 5000, 400);
    expect(result.action).toBe("fill");
    expect(result.candidateTotalCents).toBe(5400);
  });

  it("treats an exactly-matching total as ok", () => {
    const result = reconcileInvoiceTotal(5400, 5000, 400);
    expect(result.action).toBe("ok");
  });

  it("tolerates a 1-cent rounding difference (matches the client-side check)", () => {
    const result = reconcileInvoiceTotal(5401, 5000, 400);
    expect(result.action).toBe("ok");
    expect(INVOICE_RECONCILE_TOLERANCE_CENTS).toBe(1);
  });

  it("blocks confirmation when the stored total doesn't reconcile with lines + tax", () => {
    // The reported bug shape: real lines sum to real money, but total was left stale/wrong.
    const result = reconcileInvoiceTotal(0, 31250, 0);
    expect(result.action).toBe("block");
    expect(result.candidateTotalCents).toBe(31250);
  });

  it("blocks on a large mismatch even when both values are non-zero", () => {
    const result = reconcileInvoiceTotal(500, 31250, 0);
    expect(result.action).toBe("block");
  });

  it("does NOT block when the stored total is genuinely zero, regardless of tax", () => {
    const result = reconcileInvoiceTotal(0, 0, 0);
    expect(result.action).toBe("ok");
  });

  it("treats tax as additive when checking reconciliation", () => {
    const result = reconcileInvoiceTotal(10800, 10000, 800);
    expect(result.action).toBe("ok");
  });
});
