// packages/ai/src/recipe-extraction.spec.ts
// Unit tests for recipe extraction using the Passionfruit Custard fixture.
// OpenAI is mocked so no API key or network required.

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
    expect(result.data.name).toBe("Passionfruit Custard With Pistachio Crumbs");
    expect(result.source).toBe("vision");
  });

  it("Milk has quantity=1250 and unit=ML (not oz)", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const milk = result.data.ingredientLines.find(l =>
      l.name.toLowerCase() === "milk",
    );
    expect(milk).toBeDefined();
    expect(milk!.quantity).toBe(1250);
    expect(milk!.unit).toBe("ML");
  });

  it("Cream has quantity=2000 and unit=ML", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const cream = result.data.ingredientLines.find(l =>
      l.name.toLowerCase() === "cream",
    );
    expect(cream).toBeDefined();
    expect(cream!.quantity).toBe(2000);
    expect(cream!.unit).toBe("ML");
  });

  it("Egg Yolks has quantity=20 and unit=EACH", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const eggs = result.data.ingredientLines.find(l =>
      l.name.toLowerCase().includes("egg"),
    );
    expect(eggs).toBeDefined();
    expect(eggs!.quantity).toBe(20);
    expect(eggs!.unit).toBe("EACH");
  });

  it("Corn Flour has quantity=100 and unit=G", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const corn = result.data.ingredientLines.find(l =>
      l.name.toLowerCase().includes("corn flour"),
    );
    expect(corn).toBeDefined();
    expect(corn!.quantity).toBe(100);
    expect(corn!.unit).toBe("G");
  });

  it("Caster Sugar has quantity=1125 and unit=G", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const sugar = result.data.ingredientLines.find(l =>
      l.name.toLowerCase().includes("sugar"),
    );
    expect(sugar).toBeDefined();
    expect(sugar!.quantity).toBe(1125);
    expect(sugar!.unit).toBe("G");
  });

  it("Fresh Passionfruit Juice has unit=ML", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const pfjuice = result.data.ingredientLines.find(l =>
      l.name.toLowerCase().includes("passionfruit juice"),
    );
    expect(pfjuice).toBeDefined();
    expect(pfjuice!.quantity).toBe(2000);
    expect(pfjuice!.unit).toBe("ML");
  });

  it("Orange Juice has quantity=1000 and unit=ML", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const oj = result.data.ingredientLines.find(l =>
      l.name.toLowerCase().includes("orange juice"),
    );
    expect(oj).toBeDefined();
    expect(oj!.quantity).toBe(1000);
    expect(oj!.unit).toBe("ML");
  });

  it("no ingredient defaults to 'oz' or 'each' when an explicit unit is known", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const liquidItems = result.data.ingredientLines.filter(l =>
      ["milk", "cream", "orange juice", "passionfruit juice"].some(name =>
        l.name.toLowerCase().includes(name),
      ),
    );
    expect(liquidItems.length).toBeGreaterThan(0);
    for (const item of liquidItems) {
      expect(item.unit).not.toBe("oz");
      expect(item.unit).not.toBe("each");
    }
  });

  it("percentUtilized is null for items without explicit utilization (not defaulted to 100)", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const milk = result.data.ingredientLines.find(l => l.name.toLowerCase() === "milk");
    expect(milk!.percentUtilized).toBeNull();
  });

  it("Passionfruit with explicit 60% utilization has percentUtilized=60", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    const pf = result.data.ingredientLines.find(l =>
      l.name.toLowerCase() === "passionfruit",
    );
    expect(pf).toBeDefined();
    expect(pf!.percentUtilized).toBe(60);
  });

  it("extracts 8 ingredient lines", async () => {
    const result = await extractRecipeFromImage({ imageUrl: "data:image/jpeg;base64,abc" });
    expect(result.data.ingredientLines).toHaveLength(8);
  });
});
