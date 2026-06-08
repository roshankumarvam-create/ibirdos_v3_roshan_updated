// packages/ai/src/invoice-extraction.spec.ts
// Unit tests for invoice extraction using the Sysco #1277265 fixture.
// OpenAI is mocked so no API key or network required.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the config module — must be before the module-under-test loads
vi.mock("@ibirdos/config", () => ({
  env: {
    OPENAI_API_KEY: "test-key",
    OPENAI_VISION_MODEL: "gpt-4o",
    R2_ENDPOINT: "http://localhost:9000",
    R2_BUCKET: "ibirdos",
    R2_ACCESS_KEY_ID: "dev",
    R2_SECRET_ACCESS_KEY: "dev",
  },
}));

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import fixture from "./__fixtures__/sysco-1277265.json";
import fixture2 from "./__fixtures__/sysco-913814357.json";

// Mock OpenAI — we swap out the fixture per describe block via createMock.mockResolvedValue
let activeFixture: any = fixture;

vi.mock("openai", () => {
  const createMock = vi.fn().mockImplementation(() =>
    Promise.resolve({
      choices: [{ message: { content: JSON.stringify(activeFixture) } }],
      usage: { prompt_tokens: 500, completion_tokens: 800 },
    }),
  );

  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  }));

  return { default: OpenAI };
});

import { extractInvoice } from "./invoice-extraction";

describe("extractInvoice — Sysco Intermountain #1277265", () => {
  const FAKE_BUFFER = Buffer.from("fake-image-bytes");

  beforeEach(() => {
    activeFixture = fixture;
    vi.clearAllMocks();
  });

  it("returns the correct line count", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    expect(result.data.lines).toHaveLength(9);
  });

  it("line sum equals printedTotal (reconciles)", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const lineSum = result.data.lines.reduce((s, l) => s + l.extendedPriceCents, 0);
    expect(lineSum).toBe(32490);
    expect(lineSum).toBe(result.data.totalCents);
    expect(result.data.reconciles).toBe(true);
  });

  it("Dill Baby Herb extendedPriceCents is 1525 (not 5250)", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const dill = result.data.lines.find((l) =>
      l.descriptionRaw.toLowerCase().includes("dill"),
    );
    expect(dill).toBeDefined();
    expect(dill!.extendedPriceCents).toBe(1525);
  });

  it("Baby Carrot Tri-Color has qty=2 and extendedPriceCents=6500", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const carrot = result.data.lines.find((l) =>
      l.descriptionRaw.toLowerCase().includes("carrot"),
    );
    expect(carrot).toBeDefined();
    expect(carrot!.quantity).toBe(2);
    expect(carrot!.extendedPriceCents).toBe(6500);
  });

  it("all 8 inventory vendorItemCodes are present (not null)", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const inventoryLines = result.data.lines.filter((l) => l.lineType === "inventory");
    const codes = inventoryLines.map((l) => l.vendorItemCode).filter(Boolean);
    const expectedCodes = ["2822312", "5148453", "6344790", "1995125", "5228424", "2005148", "2034023", "7680291"];
    for (const code of expectedCodes) {
      expect(codes).toContain(code);
    }
  });

  it("no line has description containing GROUP TOTAL", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const groupTotalLine = result.data.lines.find((l) =>
      l.descriptionRaw.toUpperCase().includes("GROUP TOTAL"),
    );
    expect(groupTotalLine).toBeUndefined();
  });

  it("Fuel Surcharge is lineType misc_charge", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const fuel = result.data.lines.find((l) =>
      l.descriptionRaw.toLowerCase().includes("fuel"),
    );
    expect(fuel).toBeDefined();
    expect(fuel!.lineType).toBe("misc_charge");
    expect(fuel!.vendorItemCode).toBeNull();
  });

  it("Chicken CVP Wing size is 162ct JMB RND (not 16/21)", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const chicken = result.data.lines.find((l) =>
      l.descriptionRaw.toLowerCase().includes("chicken"),
    );
    expect(chicken).toBeDefined();
    expect(chicken!.size).toContain("162ct");
    expect(chicken!.size).not.toContain("16/21");
  });

  it("extracts vendorName and invoiceNumber correctly", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    expect(result.data.vendorName).toBe("Sysco Intermountain, Inc.");
    expect(result.data.invoiceNumber).toBe("1277265");
  });

  it("extracts both invoiceDate and dueDate", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    expect(result.data.invoiceDate).toBe("2020-07-14");
    expect(result.data.dueDate).toBe("2020-07-25");
  });
});

// ─── Sysco Central Texas #913814357 ───────────────────────────────────────────
// Multi-page invoice: partial page with GROUP TOTAL rows, no printed INVOICE TOTAL.
// Tests QTY parsing (split-case "2S" → qty=2, unit=SP) and catch-weight (40 LB).

describe("extractInvoice — Sysco Central Texas #913814357 (partial, group totals)", () => {
  const FAKE_BUFFER = Buffer.from("fake-image-bytes");

  beforeEach(() => {
    activeFixture = fixture2;
    vi.clearAllMocks();
  });

  it("is_partial=true and totalCents=0 (no printed invoice total)", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    expect(result.data.isPartial).toBe(true);
    expect(result.data.totalCents).toBe(0);
  });

  it("reconciles=true using groupTotals (MEATS lines sum to printed $542.66)", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    expect(result.data.reconciles).toBe(true);
    const meatLines = result.data.lines.filter(l => l.category === "MEATS");
    const meatSum = meatLines.reduce((s, l) => s + l.extendedPriceCents, 0);
    expect(meatSum).toBe(54266);
    expect(result.data.groupTotals["MEATS"]).toBe(54266);
  });

  it("groupTotals has DAIRY, MEATS, POULTRY, MISC CHARGES keys", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    expect(result.data.groupTotals).toHaveProperty("DAIRY");
    expect(result.data.groupTotals).toHaveProperty("MEATS");
    expect(result.data.groupTotals).toHaveProperty("POULTRY");
    expect(result.data.groupTotals).toHaveProperty("MISC CHARGES");
  });

  it("Buttermilk split-case has qty=2 and unit=SP (parsed from '2S' in QTY column)", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const buttermilk = result.data.lines.find(l =>
      l.descriptionRaw.toLowerCase().includes("buttermilk"),
    );
    expect(buttermilk).toBeDefined();
    expect(buttermilk!.quantity).toBe(2);
    expect(buttermilk!.unit).toBe("SP");
    expect(buttermilk!.lineStatus).toBe("in_stock");
  });

  it("Beef Ground catch-weight has qty=40, unit=LB, extendedPriceCents=17324", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const beefCw = result.data.lines.find(l =>
      l.descriptionRaw.toLowerCase().includes("catch weight") ||
      (l.descriptionRaw.toLowerCase().includes("beef") && l.unit === "LB"),
    );
    expect(beefCw).toBeDefined();
    expect(beefCw!.quantity).toBe(40);
    expect(beefCw!.unit).toBe("LB");
    expect(beefCw!.extendedPriceCents).toBe(17324);
  });

  it("two Chicken Breast lines both have extendedPriceCents=7472", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const chickens = result.data.lines.filter(l =>
      l.descriptionRaw.toLowerCase().includes("chicken"),
    );
    expect(chickens).toHaveLength(2);
    expect(chickens[0]!.extendedPriceCents).toBe(7472);
    expect(chickens[1]!.extendedPriceCents).toBe(7472);
  });

  it("Fuel Surcharge is misc_charge with correct amount", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const fuel = result.data.lines.find(l =>
      l.descriptionRaw.toLowerCase().includes("fuel"),
    );
    expect(fuel).toBeDefined();
    expect(fuel!.lineType).toBe("misc_charge");
    expect(fuel!.extendedPriceCents).toBe(1569);
  });

  it("DAIRY lines sum to printed groupTotals.DAIRY", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    const dairyLines = result.data.lines.filter(
      l => l.category === "DAIRY" && l.lineStatus !== "out_of_stock",
    );
    const dairySum = dairyLines.reduce((s, l) => s + l.extendedPriceCents, 0);
    expect(dairySum).toBe(result.data.groupTotals["DAIRY"]);
  });

  it("vendorName is Sysco Central Texas", async () => {
    const result = await extractInvoice({ buffer: FAKE_BUFFER, mimeType: "image/jpeg" });
    expect(result.data.vendorName).toContain("Sysco Central Texas");
    expect(result.data.invoiceNumber).toBe("913814357");
  });
});
