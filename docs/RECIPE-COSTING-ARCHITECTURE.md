# Recipe Costing Architecture

## Core Principle

**Recipe cost always equals the live sum of current ingredient prices — never a stale snapshot.**

```
totalCostCents = SUM(
  ingredientLine.quantity
  × toCanonical(ingredientLine.unit)
  × ingredient.currentCostMicrocents / 1000
  × (100 / yieldPct)
)  for all lines in recipe
```

This is computed in `apps/api/src/recipes/recipe-cost.helper.ts` by `computeLiveRecipeCost()`.

## Why `cachedCostCents` Is a Cache, Not the Source of Truth

The `recipe.cachedCostMicrocents` DB column exists for list-page performance. Without it, every request to `GET /recipes` would require N JOIN queries (one per recipe) against the ingredients table.

However, the cache is _never_ what's shown to the user. Every API response from `GET /recipes` and `GET /recipes/:id` computes `liveCostCents` from the live ingredient prices in the same query — using a single `findMany` with `include: { ingredients: { include: { ingredient: {...} } } }`. No second round-trip.

The cache is maintained as a background safety net:

1. When an ingredient price changes → `ingredient.cost_changed` Redis pub/sub event fires
2. Worker debounces (1.5s) and processes a `recost-by-ingredient` BullMQ job
3. Job calls `computeLiveRecipeCost()` and writes the result back to `cachedCostMicrocents`
4. If this write is late or misses (Redis down, worker restart), the next live API call is still correct

Belt-and-suspenders: `InvoicesService.confirm()` also directly enqueues recost jobs, bypassing pub/sub, so invoice confirmations never miss the cache update.

## Live Computation Flow

```
GET /recipes (or /recipes/:id)
  └─ prisma.recipe.findMany({ include: { ingredients: { include: { ingredient } } } })
  └─ computeLiveRecipeCost(recipe)          ← always fresh, uses current ingredient prices
  └─ return { liveCostCents, liveBreakdown, cachedCostCents, cachedCostUpdatedAt }
```

The `liveCostCents` field is what the UI displays. `cachedCostCents` is available for comparison only (shown as tooltip: "Cache updated X ago").

## Historical Event Freezing

Catering events must retain the ingredient prices that were current at booking time. If chicken goes from $5/lb to $8/lb after a customer paid, their locked-in quote should not change.

### Freeze State Machine

```
DRAFT ──→ CONFIRMED ──→ PREP_IN_PROGRESS ──→ IN_SERVICE ──→ COMPLETED
  │            │              │                   │              │
  │         FREEZE          FREEZE               FREEZE        FREEZE (if not already)
  │
  └──→ CANCELLED (freeze on transition)
```

The first transition into any of `CONFIRMED / PREP_IN_PROGRESS / IN_SERVICE / COMPLETED / CANCELLED` triggers a freeze if the event is not already frozen.

### What Gets Frozen

On `PATCH /events/:id/status`, when `shouldFreeze` is true:
- `frozenAt` = `now()`
- `frozenRecipeCostsCents` = `{ [recipeId]: cachedCostMicrocents/1000 }` for every recipe on the menu
- `frozenIngredientPricesCents` = `{ [ingredientId]: currentCostMicrocents/1000 }` for every ingredient used by any recipe on the menu

After freezing, the `/events/:id` detail page shows "🔒 Frozen quote · <date>" instead of "Live quote".

### Using Frozen vs Live Prices

| Event state   | Cost source                  |
|---------------|------------------------------|
| DRAFT         | Live ingredient prices       |
| CONFIRMED+    | `frozenIngredientPricesCents` snapshot |

Events pages show the `computedFoodCostCents` field which is computed at kitchen-packet generation time (before freeze) or at freeze time. For future work: regenerating the kitchen packet post-freeze should use the snapshot, not live prices.

## Notification on Recost

When the recost worker detects that N recipes changed cost by more than $0.01, it creates one `Notification` (kind=GENERIC) visible workspace-wide:

> "12 recipes automatically recalculated because Chicken Bone cost changed from $10.00 to $12.00."

This is handled in `recipe-recost.worker.ts → publishRecostNotification()`.

## File Map

| File | Purpose |
|------|---------|
| `apps/api/src/recipes/recipe-cost.helper.ts` | Pure `computeLiveRecipeCost()` function |
| `apps/api/src/recipes/recipes.service.ts` | Uses helper in `list()` and `get()`; cache writes in `recost()` |
| `apps/api/src/workers/recipe-recost.worker.ts` | Cache write-through + notification publishing |
| `apps/api/src/events/events.service.ts` | `updateStatus()` + `freezeEvent()` |
| `packages/db/prisma/schema.prisma` | `Recipe.cachedCostMicrocents`, `Event.frozenAt`, `Event.frozenRecipeCostsCents` |
