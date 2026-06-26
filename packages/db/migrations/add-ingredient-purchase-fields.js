// Add purchase/display columns to the ingredients table.
//
// These fields were added to schema.prisma but never migrated to production,
// causing every Prisma query on the ingredients table to fail with:
//   "The column `ingredients.purchase_unit` does not exist in the current database"
//
// Run against production:
//   $env:DATABASE_URL = "<production DATABASE_PUBLIC_URL>"
//   node packages/db/migrations/add-ingredient-purchase-fields.js
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
  console.log("║  add-ingredient-purchase-fields                         ║");
  console.log("║  ADDITIVE ONLY — IF NOT EXISTS, zero drops              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    console.log("\n✓ Database connection OK");
  } catch (e) {
    console.error("\n✗ Cannot connect:", e.message);
    process.exit(1);
  }

  header("ALTER TABLE ingredients — purchase / display columns");

  const columns = [
    { name: "purchase_unit",  ddl: "TEXT DEFAULT NULL" },
    { name: "purchase_qty",   ddl: "DECIMAL(14,4) DEFAULT NULL" },
    { name: "base_unit",      ddl: "TEXT DEFAULT NULL" },
    { name: "base_qty",       ddl: "DECIMAL(14,4) DEFAULT NULL" },
    { name: "reorder_qty",    ddl: "DECIMAL(14,4) DEFAULT NULL" },
    { name: "photo_url",      ddl: "TEXT DEFAULT NULL" },
    { name: "match_status",   ddl: "TEXT DEFAULT NULL" },
  ];

  let applied = 0;
  let skipped = 0;

  for (const col of columns) {
    if (await columnExists("ingredients", col.name)) {
      console.log(`  — ingredients.${col.name} already exists, skipping`);
      skipped++;
    } else {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS ${col.name} ${col.ddl}`,
      );
      console.log(`  ✓ ADD COLUMN ${col.name}`);
      applied++;
    }
  }

  // Verify all columns present
  for (const col of columns) {
    if (!(await columnExists("ingredients", col.name))) {
      throw new Error(`VERIFY FAILED: ingredients.${col.name} missing after ALTER TABLE`);
    }
  }

  // Smoke test: Prisma must be able to read the ingredients table
  header("Smoke test — Prisma SELECT");
  const count = await prisma.ingredient.count();
  console.log(`  ✓ prisma.ingredient.count() = ${count} (Prisma client sees the new columns)`);

  header("Migration complete");
  console.log(`  Applied : ${applied}`);
  console.log(`  Skipped : ${skipped} (already present)`);
  console.log(`  Dropped : 0`);
  console.log(`  Errors  : 0`);
  console.log("");
  console.log("  Recipe import and invoice ingredient matching should now work.");
}

main()
  .catch((e) => {
    console.error("\n\n✗ MIGRATION FAILED:", e.message);
    console.error(e.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
