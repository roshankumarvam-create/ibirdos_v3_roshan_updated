-- Run once after the first prisma migrate. The trigram extension
-- enables ingredient fuzzy matching ("CHK BRST" → "Chicken Breast").
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN indexes on the columns we trigram-search
CREATE INDEX IF NOT EXISTS idx_ingredients_name_trgm
  ON ingredients USING gin (LOWER(name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ingredient_aliases_text_trgm
  ON ingredient_aliases USING gin (text gin_trgm_ops);
