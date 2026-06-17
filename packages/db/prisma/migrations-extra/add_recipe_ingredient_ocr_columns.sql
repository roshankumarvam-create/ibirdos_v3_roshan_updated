-- Add OCR extraction columns to recipe_ingredients.
-- These columns were added to schema.prisma as part of the Recipe OCR / native-unit
-- refactor but no migration was created at the time.  All columns are nullable
-- (or have a NOT NULL DEFAULT) so existing rows are unaffected.
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS qty_native       DECIMAL(14,4) DEFAULT NULL;
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS unit_native      TEXT          DEFAULT NULL;
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS oz_equivalent    DECIMAL(14,4) DEFAULT NULL;
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS low_confidence   BOOLEAN       NOT NULL DEFAULT false;
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS conversion_note  TEXT          DEFAULT NULL;
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS prep_note        TEXT          DEFAULT NULL;
ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS size_qualifier   TEXT          DEFAULT NULL;
