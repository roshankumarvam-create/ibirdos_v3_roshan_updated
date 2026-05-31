---
name: project-recipe-build
description: Create Recipe flow build — schema additions, cascade chain details, and deferred items
metadata:
  type: project
---

Recipe creation flow completed May 30 2026.

**Why:** Full Webtrition-style recipe sheet with live cost computation, price cascade, and photo uploads.

**Schema additions (applied via ALTER TABLE, no migrations dir):**
- recipes: author_name, portion_weight_g, portion_volume_ml, goal_food_cost_pct, paper_cost_cents, cached_cost_per_portion_microcents, cached_margin_cents, prep_photo_url, final_photo_url, video_url
- recipe_ingredients: external_code, weight_oz
- Existing field mappings: portionsYielded=totalPortions, prepTimeMin=prepTimeMinutes, cookTimeMin=cookTimeMinutes, salePriceCents=actualSellPriceCents, instructionsMd=procedure, cachedCostMicrocents=total cost

**Price cascade chain (fully wired):**
ingredients.service.ts updatePrice() → Redis pub "ingredient.cost_changed" → recipe-recost.worker.ts subscriber → BullMQ job "recost-by-ingredient" (1500ms debounce) → recostAllUsingIngredient() → per-recipe recost()

**New unit added:** slice (COUNT, toCanonical=1) in packages/types/src/units.ts

**API field mapping:** CreateRecipeInputSchema in packages/types accepts ingredientLines (frontend field) which maps to ingredients in service. percentUtilized maps to yieldPctOverride.

**Photo upload:** presign endpoint at POST /api/v1/uploads/presign with purpose="recipe". File size limit 25MB. Fully wired in the frontend.

**BLOCKED — Inventory CONSUME on kitchen DONE:** kitchen.service.ts updateTask() does NOT create InventoryTransaction CONSUME when status → DONE. Needs a future task.

**Frontend page:** apps/web/src/app/[workspace]/recipes/new/page.tsx

**How to apply:** When building recipe-related features, note that the DB has no migrations directory — schema changes go via ALTER TABLE + prisma generate. The project uses prisma db push / direct SQL rather than prisma migrate dev.
