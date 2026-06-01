-- Add targetMarginPct to recipes table.
-- When set, the recost worker will recalculate salePriceCents to maintain this margin
-- automatically after any ingredient price change.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS target_margin_pct DECIMAL(5,2) DEFAULT NULL;
