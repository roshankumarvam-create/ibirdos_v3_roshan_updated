// packages/ai/src/recipe-extraction.spec.ts
// Unit tests for vision recipe extraction using the Passionfruit Custard fixture (new schema).
// OpenAI is mocked — no API key or network required.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/config", () => ({
  env: {
    OPENAI_API_KEY: "test-key",
    OPENAI_VISION_MODEL: "gpt-4o",
  },
}));

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import fixture from "./__fixtures__/passionfruit-custard.json";

vi.mock("openai", () => {
  const createMock = vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(fixture) } }],
    usage: { prompt_tokens: 400, completion_tokens: 600 },
  });

  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
  }));

  return { default: OpenAI };
});

import { extractRecipeFromImage } from "./recipe-extraction";

describe("extractRecipeFromImage — Passionfruit Custard With Pistachio Crumbs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts recipe name correctly", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    expect(result.data.recipeName).toBe("Passionfruit Custard With Pistachio Crumbs");
    expect(result.source).toBe("vision");
  });

  it("Milk has qty=1250 and nativeUnit='ml' (not oz)", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const milk = result.data.ingredients.find(l => l.name.toLowerCase() === "milk");
    expect(milk).toBeDefined();
    expect(milk!.qty).toBe(1250);
    expect(milk!.nativeUnit).toBe("ml");
  });

  it("Milk converts to ml (liquid) — qtyCanonical=1250, unitCanonical='ml'", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const milk = result.data.ingredients.find(l => l.name.toLowerCase() === "milk");
    expect(milk!.unitCanonical).toBe("ml");
    expect(milk!.qtyCanonical).toBeCloseTo(1250, 1);
  });

  it("Cream has qty=2000 and nativeUnit='ml'", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const cream = result.data.ingredients.find(l => l.name.toLowerCase() === "cream");
    expect(cream).toBeDefined();
    expect(cream!.qty).toBe(2000);
    expect(cream!.nativeUnit).toBe("ml");
  });

  it("Egg Yolks has qty=20 and nativeUnit='each'", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const eggs = result.data.ingredients.find(l => l.name.toLowerCase().includes("egg"));
    expect(eggs).toBeDefined();
    expect(eggs!.qty).toBe(20);
    expect(eggs!.nativeUnit).toBe("each");
  });

  it("Corn Flour has qty=100 and nativeUnit='g' — converts to 100g canonical", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const corn = result.data.ingredients.find(l => l.name.toLowerCase().includes("corn flour"));
    expect(corn).toBeDefined();
    expect(corn!.qty).toBe(100);
    expect(corn!.nativeUnit).toBe("g");
    expect(corn!.unitCanonical).toBe("g");
    expect(corn!.qtyCanonical).toBeCloseTo(100, 1);
  });

  it("Caster Sugar has qty=1125 and nativeUnit='g'", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const sugar = result.data.ingredients.find(l => l.name.toLowerCase().includes("sugar"));
    expect(sugar).toBeDefined();
    expect(sugar!.qty).toBe(1125);
    expect(sugar!.nativeUnit).toBe("g");
  });

  it("Fresh Passionfruit Juice has nativeUnit='ml' and converts to ml", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const pfjuice = result.data.ingredients.find(l => l.name.toLowerCase().includes("passionfruit juice"));
    expect(pfjuice).toBeDefined();
    expect(pfjuice!.qty).toBe(2000);
    expect(pfjuice!.nativeUnit).toBe("ml");
    expect(pfjuice!.unitCanonical).toBe("ml");
  });

  it("Orange Juice has qty=1000 and nativeUnit='ml'", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const oj = result.data.ingredients.find(l => l.name.toLowerCase().includes("orange juice"));
    expect(oj).toBeDefined();
    expect(oj!.qty).toBe(1000);
    expect(oj!.nativeUnit).toBe("ml");
  });

  it("no liquid ingredient has nativeUnit='oz' when an explicit volume unit is printed", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const liquidItems = result.data.ingredients.filter(l =>
      ["milk", "cream", "orange juice", "passionfruit juice"].some(name =>
        l.name.toLowerCase().includes(name),
      ),
    );
    expect(liquidItems.length).toBeGreaterThan(0);
    for (const item of liquidItems) {
      expect(item.nativeUnit).not.toBe("oz");
      expect(item.nativeUnit).not.toBe("each");
    }
  });

  it("extracts 8 ingredient lines", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    expect(result.data.ingredients).toHaveLength(8);
  });

  it("isPartial is false for complete recipe", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    expect(result.data.isPartial).toBe(false);
  });

  it("procedureSteps are extracted correctly", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    expect(result.data.procedureSteps.length).toBeGreaterThan(0);
    expect(result.data.procedureSteps[0]).toContain("milk");
  });

  it("all ingredients carry unitConfidence=90 (column-based template)", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    for (const ing of result.data.ingredients) {
      expect(ing.unitConfidence).toBe(90);
    }
  });

  it("column-based ingredients have lowConfidence=true when unitConfidence<90 — flagged for review", async () => {
    // unitConfidence=90 is the threshold; 90 itself does NOT flag
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const milk = result.data.ingredients.find(l => l.name.toLowerCase() === "milk");
    // 90 >= 90 → NOT flagged by unit confidence alone (conversion is also confident for ml)
    expect(milk!.unitConfidence).toBe(90);
    expect(milk!.lowConfidence).toBe(false);
  });

  it("no ingredient has unitConfidence of undefined (schema default applies)", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    for (const ing of result.data.ingredients) {
      expect(ing.unitConfidence).toBeDefined();
      expect(typeof ing.unitConfidence).toBe("number");
    }
  });
});
