import { describe, it, expect } from "vitest";
import { extractRecipesFromRows } from "./recipe-spreadsheet-parser";

// ─── Format A (flat layout) ─────────────────────────────────────────────────

describe("Format A — flat layout (recipe name repeats per ingredient row)", () => {
  it("fixes the 'Name = Category' bug — header row is NOT treated as label:value", () => {
    const rows = [
      ["Recipe Name", "Category", "Ingredient", "Qty", "Unit"],
      ["Chicken Wings", "Appetizer", "Chicken Wings", "2", "lb"],
      ["Chicken Wings", "Appetizer", "Buffalo Sauce", "0.25", "cup"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(1);
    const recipe = result.recipes[0]!;
    expect(recipe.name).toBe("Chicken Wings");
    expect(recipe.name).not.toBe("Category");
    expect(recipe.category).toBe("Appetizer");
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.ingredients[0]!.ingredient_name).toBe("Chicken Wings");
    expect(recipe.ingredients[1]!.ingredient_name).toBe("Buffalo Sauce");
  });

  it("groups multiple recipes from a flat sheet", () => {
    const rows = [
      ["Recipe Name", "Category", "Ingredient", "Qty", "Unit"],
      ["Caesar Salad", "Salad", "Romaine Lettuce", "1", "head"],
      ["Caesar Salad", "Salad", "Croutons", "0.5", "cup"],
      ["Tomato Soup", "Soup", "Tomatoes", "3", "lb"],
      ["Tomato Soup", "Soup", "Onion", "1", "each"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(2);
    const names = result.recipes.map(r => r.name);
    expect(names).toContain("Caesar Salad");
    expect(names).toContain("Tomato Soup");
    const caesar = result.recipes.find(r => r.name === "Caesar Salad")!;
    expect(caesar.ingredients).toHaveLength(2);
    const soup = result.recipes.find(r => r.name === "Tomato Soup")!;
    expect(soup.ingredients).toHaveLength(2);
  });

  it("preserves ingredient names exactly — no trimming or synonym mapping", () => {
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["My Recipe", "Butter (unsalted)", "2", "tbsp"],
      ["My Recipe", "  Leading Space Ingredient  ", "1", "cup"],
    ];
    const result = extractRecipesFromRows(rows);
    const recipe = result.recipes[0]!;
    // The XLSX cell() normalizer does trim, but the NAME is preserved from the spreadsheet value
    expect(recipe.ingredients[0]!.ingredient_name).toBe("Butter (unsalted)");
    // Leading/trailing whitespace in the raw cell is normalized by cell() helper (trimmed),
    // but the actual name content is preserved
    expect(recipe.ingredients[1]!.ingredient_name).toBe("Leading Space Ingredient");
  });

  it("parses quantity and unit correctly", () => {
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["Test Recipe", "Flour", "2.5", "cups"],
    ];
    const result = extractRecipesFromRows(rows);
    const ing = result.recipes[0]!.ingredients[0]!;
    expect(ing.quantity).toBe(2.5);
    expect(ing.unit).toBe("cups");
  });

  it("accepts column aliases (QTY → quantity, UOM → unit)", () => {
    const rows = [
      ["Recipe Name", "Ingredient Name", "QTY", "UOM"],
      ["Risotto", "Arborio Rice", "1", "lb"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(1);
    const ing = result.recipes[0]!.ingredients[0]!;
    expect(ing.ingredient_name).toBe("Arborio Rice");
    expect(ing.quantity).toBe(1);
    expect(ing.unit).toBe("lb");
  });

  it("handles yield and prep/cook time columns", () => {
    const rows = [
      ["Recipe Name", "Category", "Yield Portions", "Prep Time Min", "Cook Time Min", "Ingredient", "Qty", "Unit"],
      ["Pasta", "Main", "4", "10", "20", "Spaghetti", "200", "g"],
    ];
    const result = extractRecipesFromRows(rows);
    const recipe = result.recipes[0]!;
    expect(recipe.yield_portions).toBe(4);
    expect(recipe.prep_time_minutes).toBe(10);
    expect(recipe.cook_time_minutes).toBe(20);
  });

  it("reports high confidence (≥0.95) when canonical column names are used", () => {
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["Test", "Salt", "1", "tsp"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes[0]!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.needsReview).toBe(false);
  });
});

// ─── Format B (block layout) ─────────────────────────────────────────────────

describe("Format B — block layout (label:value metadata above ingredient table)", () => {
  it("extracts recipe name from label:value rows above ingredient table", () => {
    const rows = [
      ["Recipe Name:", "Beef Stew", "", ""],
      ["Category:", "Main Course", "", ""],
      ["Yield Portions:", "6", "", ""],
      ["", "", "", ""],
      ["Ingredient", "Qty", "Unit", "Notes"],
      ["Beef Chuck", "2", "lb", "cubed"],
      ["Carrots", "3", "each", ""],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(1);
    const recipe = result.recipes[0]!;
    expect(recipe.name).toBe("Beef Stew");
    expect(recipe.category).toBe("Main Course");
    expect(recipe.yield_portions).toBe(6);
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.ingredients[0]!.ingredient_name).toBe("Beef Chuck");
    expect(recipe.ingredients[1]!.ingredient_name).toBe("Carrots");
  });

  it("does NOT produce name='Category' from Format B label:value rows", () => {
    const rows = [
      ["Recipe Name:", "Mushroom Risotto", "", ""],
      ["Category:", "Vegetarian", "", ""],
      ["Ingredient", "Amount", "UOM"],
      ["Arborio Rice", "300", "g"],
      ["Mushrooms", "200", "g"],
    ];
    const result = extractRecipesFromRows(rows);
    const recipe = result.recipes[0]!;
    expect(recipe.name).toBe("Mushroom Risotto");
    expect(recipe.name).not.toBe("Category");
  });

  it("returns warnings and needsReview when recipe name is missing in Format B", () => {
    const rows = [
      ["Ingredient", "Qty", "Unit"],
      ["Tomatoes", "5", "lb"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(0);
    expect(result.unparsed.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("returns empty result with message for completely empty rows", () => {
    const result = extractRecipesFromRows([]);
    expect(result.recipes).toHaveLength(0);
    expect(result.unparsed.length).toBeGreaterThan(0);
    expect(result.needsReview).toBe(true);
  });

  it("returns empty result with message when no recognizable headers", () => {
    const rows = [
      ["Foo", "Bar", "Baz"],
      ["1", "2", "3"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(0);
    expect(result.unparsed.length).toBeGreaterThan(0);
  });

  it("carries forward the last recipe for rows with empty recipe name in Format A", () => {
    // Format A flat: recipe name appears only on the FIRST ingredient row;
    // continuation rows have an empty Recipe Name cell but still belong to the same recipe.
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["Salad", "Lettuce", "1", "head"],
      ["", "Mystery item", "1", "each"],  // empty recipe name → belongs to Salad
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]!.ingredients).toHaveLength(2);
    expect(result.recipes[0]!.ingredients[1]!.ingredient_name).toBe("Mystery item");
  });

  it("skips orphan ingredient rows that appear before any recipe name", () => {
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["", "Orphan item", "1", "each"],  // no recipe started yet — truly orphaned
      ["Salad", "Lettuce", "1", "head"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]!.ingredients).toHaveLength(1);
    expect(result.recipes[0]!.ingredients[0]!.ingredient_name).toBe("Lettuce");
  });

  it("parses Cajun Chicken Wings fixture — 6 ingredients, carry-forward recipe name", () => {
    // Mirrors the exact XLSX the client uploaded: recipe name + metadata on row 2 only,
    // rows 3-7 have empty Recipe Name but belong to the same recipe.
    const rows = [
      ["Recipe Name", "Category", "Yield Portions", "Prep Time Min", "Cook Time Min", "Ingredient", "Qty", "Unit", "% Utilized", "Notes"],
      ["Cajun Chicken Wings", "APPETIZER", "10", "20", "25", "Chicken Wing", "5", "LB", "90", ""],
      ["", "", "", "", "", "Cajun Seasoning", "0.25", "LB", "100", ""],
      ["", "", "", "", "", "Fresh Dill Baby Fresh Herb", "0.05", "LB", "80", "Garnish"],
      ["", "", "", "", "", "Cucumber Pickling Fresh", "2", "LB", "95", "Side"],
      ["", "", "", "", "", "Carrot Baby Peeled Tri Color", "1", "LB", "90", "Side"],
      ["", "", "", "", "", "Salt Kosher", "0.05", "LB", "100", ""],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes).toHaveLength(1);
    const r = result.recipes[0]!;
    expect(r.name).toBe("Cajun Chicken Wings");
    expect(r.category).toBe("APPETIZER");
    expect(r.yield_portions).toBe(10);
    expect(r.prep_time_minutes).toBe(20);
    expect(r.cook_time_minutes).toBe(25);
    expect(r.ingredients).toHaveLength(6);
    // Names preserved verbatim
    expect(r.ingredients[0]!.ingredient_name).toBe("Chicken Wing");
    expect(r.ingredients[1]!.ingredient_name).toBe("Cajun Seasoning");
    expect(r.ingredients[2]!.ingredient_name).toBe("Fresh Dill Baby Fresh Herb");
    expect(r.ingredients[3]!.ingredient_name).toBe("Cucumber Pickling Fresh");
    expect(r.ingredients[4]!.ingredient_name).toBe("Carrot Baby Peeled Tri Color");
    expect(r.ingredients[5]!.ingredient_name).toBe("Salt Kosher");
    // Quantities, units, utilization, notes preserved
    expect(r.ingredients[0]!.quantity).toBe(5);
    expect(r.ingredients[0]!.unit).toBe("LB");
    expect(r.ingredients[0]!.utilization_percent).toBe(90);
    expect(r.ingredients[2]!.notes).toBe("Garnish");
    expect(r.ingredients[3]!.notes).toBe("Side");
  });

  it("handles numeric cell values (xlsx sometimes returns numbers)", () => {
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["Budget Pasta", "Pasta", 200, "g"],
      ["Budget Pasta", "Sauce", 0.5, "jar"],
    ];
    const result = extractRecipesFromRows(rows as (string | number)[][]);
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]!.ingredients[0]!.quantity).toBe(200);
    expect(result.recipes[0]!.ingredients[1]!.quantity).toBe(0.5);
  });

  // Regression: BUG B — ingredient names must be preserved exactly from the spreadsheet.
  // The inventory-matching step runs AFTER parsing and must never mutate ingredient_name.
  it("preserves 'Fresh Passionfruit Juice' verbatim — not replaced by any matched inventory name", () => {
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["Custard", "Fresh Passionfruit Juice", "2000", "ml"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes[0]!.ingredients[0]!.ingredient_name).toBe("Fresh Passionfruit Juice");
  });

  it("unit is read verbatim from the Unit column — not converted, not defaulted to oz", () => {
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["Custard", "Milk", "1250", "ml"],
      ["Custard", "Corn Flour", "100", "g"],
      ["Custard", "Egg Yolks", "20", "each"],
    ];
    const result = extractRecipesFromRows(rows);
    const ings = result.recipes[0]!.ingredients;
    expect(ings[0]!.unit).toBe("ml");
    expect(ings[1]!.unit).toBe("g");
    expect(ings[2]!.unit).toBe("each");
  });

  it("parses Paper Cost column and converts dollars → cents", () => {
    const rows = [
      ["Recipe Name", "Category", "Yield Portions", "Paper Cost", "Ingredient", "Qty", "Unit"],
      ["Burger", "Main", "1", "0.25", "Beef Patty", "4", "oz"],
    ];
    const result = extractRecipesFromRows(rows);
    const r = result.recipes[0]!;
    expect(r.paper_cost_cents).toBe(25);
  });

  it("paper_cost_cents is undefined when column is absent", () => {
    const rows = [
      ["Recipe Name", "Ingredient", "Qty", "Unit"],
      ["Burger", "Beef Patty", "4", "oz"],
    ];
    const result = extractRecipesFromRows(rows);
    expect(result.recipes[0]!.paper_cost_cents).toBeUndefined();
  });
});
