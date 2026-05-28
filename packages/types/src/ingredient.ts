// =====================================================================
// packages/types/src/ingredient.ts
// =====================================================================
import { z } from "zod";

export const INGREDIENT_CATEGORIES = [
  "PRODUCE", "PROTEIN", "DAIRY", "DRY_GOODS", "SPICES",
  "OIL_VINEGAR", "BEVERAGE", "FROZEN", "BAKERY",
  "PACKAGING", "CLEANING", "OTHER",
] as const;
export const IngredientCategorySchema = z.enum(INGREDIENT_CATEGORIES);
export type IngredientCategory = z.infer<typeof IngredientCategorySchema>;

export const UnitDimensionSchema = z.enum(["MASS", "VOLUME", "COUNT"]);
// UnitDimension is owned by ./units (the conversion engine). Re-using
// that type here keeps a single source of truth and avoids a duplicate
// export when both modules are barrel-exported from index.ts.
import type { UnitDimension } from "./units";

export const CreateIngredientSchema = z.object({
  name: z.string().min(2).max(120),
  category: IngredientCategorySchema.default("OTHER"),
  dimension: UnitDimensionSchema,
  canonicalUnit: z.string().min(1).max(16), // validated against UNITS at service layer
  densityGPerMl: z.number().positive().optional(),
  preferredDisplayUnit: z.string().optional(),
  reorderThresholdCanonical: z.number().nonnegative().optional(),
  defaultYieldPct: z.number().min(0).max(100).optional(),
  initialCostPerCanonicalCents: z.number().nonnegative().optional(),
  vendorId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateIngredientInput = z.infer<typeof CreateIngredientSchema>;

export const UpdateIngredientSchema = CreateIngredientSchema.partial();
export type UpdateIngredientInput = z.infer<typeof UpdateIngredientSchema>;

export const MatchIngredientSchema = z.object({
  text: z.string().min(1).max(500),
  vendorId: z.string().optional(),
});
export type MatchIngredientInput = z.infer<typeof MatchIngredientSchema>;

export interface IngredientDTO {
  id: string;
  name: string;
  category: IngredientCategory;
  dimension: UnitDimension;
  canonicalUnit: string;
  densityGPerMl: number | null;
  currentCostCents: number | null;     // converted from microcents for the client
  currentVendorId: string | null;
  currentStockCanonical: number;
  reorderThresholdCanonical: number | null;
  preferredDisplayUnit: string | null;
  defaultYieldPct: number;
  photoUrl: string | null;
  aliasCount: number;
  lastPriceChangeAt: string | null;
}

export interface IngredientMatchResult {
  ingredientId: string;
  ingredientName: string;
  matchType: "exact" | "fuzzy" | "ai" | "none";
  confidence: number;
}

export const CreateVendorSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(80).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(40).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateVendorInput = z.infer<typeof CreateVendorSchema>;
