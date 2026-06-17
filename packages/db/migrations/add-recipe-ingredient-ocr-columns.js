// Bug 3: recipe XLSX/CSV import crashes with "Something went wrong" because
// Prisma's RETURNING clause references qty_native, unit_native, etc. which
// were added to schema.prisma (recipe_ingredients) but never migrated to prod.
//
// Run against production:
//   DATABASE_URL="postgresql://..." node packages/db/migrations/add-recipe-ingredient-ocr-columns.js
//
// Fully idempotent (IF NOT EXISTS) — safe to re-run.

"use strict";

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
    table,
    column,
  );
  return rows.length > 0;
}

function header(msg) {
  console.log(`\n${"─".repeat(60)}\n  ${msg}\n${"─".repeat(60)}`);
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Bug-3: add recipe_ingredients OCR columns              ║");
  console.log("║  ADDITIVE ONLY — IF NOT EXISTS, zero drops              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    console.log("\n✓ Database connection OK");
  } catch (e) {
    console.error("\n✗ Cannot connect:", e.message);
    process.exit(1);
  }

  header("ALTER TABLE recipe_ingredients — OCR columns");

  const columns = [
    { name: "qty_native",      ddl: "DECIMAL(14,4) DEFAULT NULL" },
    { name: "unit_native",     ddl: "TEXT DEFAULT NULL" },
    { name: "oz_equivalent",   ddl: "DECIMAL(14,4) DEFAULT NULL" },
    { name: "low_confidence",  ddl: "BOOLEAN NOT NULL DEFAULT false" },
    { name: "conversion_note", ddl: "TEXT DEFAULT NULL" },
    { name: "prep_note",       ddl: "TEXT DEFAULT NULL" },
    { name: "size_qualifier",  ddl: "TEXT DEFAULT NULL" },
  ];

  let applied = 0;
  let skipped = 0;

  for (const col of columns) {
    if (await columnExists("recipe_ingredients", col.name)) {
      console.log(`  — recipe_ingredients.${col.name} already exists, skipping`);
      skipped++;
    } else {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE recipe_ingredients ADD COLUMN IF NOT EXISTS ${col.name} ${col.ddl}`,
      );
      console.log(`  ✓ ADD COLUMN ${col.name}`);
      applied++;
    }
  }

  // Verify all columns present
  for (const col of columns) {
    if (!(await columnExists("recipe_ingredients", col.name))) {
      throw new Error(`VERIFY FAILED: recipe_ingredients.${col.name} missing after ALTER TABLE`);
    }
  }

  header("Migration complete");
  console.log(`  Applied : ${applied}`);
  console.log(`  Skipped : ${skipped} (already present)`);
  console.log(`  Dropped : 0`);
  console.log(`  Errors  : 0`);
  console.log("");
  console.log("  After applying, redeploy the API so Prisma sees the new columns.");
}

main()
  .catch((e) => {
    console.error("\n\n✗ MIGRATION FAILED:", e.message);
    console.error(e.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
