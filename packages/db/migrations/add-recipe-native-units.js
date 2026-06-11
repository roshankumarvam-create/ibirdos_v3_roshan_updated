// packages/db/migrations/add-recipe-native-units.js
// Run manually after deploying the code:
//   node packages/db/migrations/add-recipe-native-units.js
//
// Adds native-unit + conversion metadata columns to recipe_ingredients.
// Idempotent — uses ADD COLUMN IF NOT EXISTS.

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  console.log("Running migration: add-recipe-native-units...");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE recipe_ingredients
      ADD COLUMN IF NOT EXISTS qty_native       DECIMAL(14, 4),
      ADD COLUMN IF NOT EXISTS unit_native      TEXT,
      ADD COLUMN IF NOT EXISTS oz_equivalent    DECIMAL(14, 4),
      ADD COLUMN IF NOT EXISTS low_confidence   BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS conversion_note  TEXT,
      ADD COLUMN IF NOT EXISTS prep_note        TEXT,
      ADD COLUMN IF NOT EXISTS size_qualifier   TEXT;
  `);

  console.log("Migration complete. Columns added to recipe_ingredients:");
  console.log("  qty_native, unit_native, oz_equivalent, low_confidence,");
  console.log("  conversion_note, prep_note, size_qualifier");
}

main()
  .catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
