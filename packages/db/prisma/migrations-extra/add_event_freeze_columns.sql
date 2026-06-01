-- Add cost-freeze columns to events table.
-- Frozen events use the snapshot JSON for cost calculations instead of live ingredient prices,
-- so historical event quotes remain stable after ingredient prices change.
ALTER TABLE events ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS frozen_recipe_costs_cents JSONB DEFAULT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS frozen_ingredient_prices_cents JSONB DEFAULT NULL;
