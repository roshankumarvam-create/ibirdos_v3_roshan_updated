// =====================================================================
// fix-soft-delete-uniqueness.js
// Deletes orphaned ingredient_alias rows for soft-deleted ingredients.
// IDEMPOTENT - safe to re-run.
// Run from packages/db/ directory:
//   cd packages/db
//   node migrations/fix-soft-delete-uniqueness.js
// =====================================================================

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  console.log("DB connecting...");
  await prisma.$queryRawUnsafe("SELECT 1");
  console.log("DB connection OK");

  const before = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS cnt FROM ingredient_aliases WHERE ingredient_id IN (SELECT id FROM ingredients WHERE deleted_at IS NOT NULL)"
  );
  const count = before[0].cnt;
  console.log("Orphaned aliases found: " + count);

  if (count === 0) {
    console.log("Nothing to delete. Already clean.");
    await prisma.$disconnect();
    return;
  }

  const sample = await prisma.$queryRawUnsafe(
    "SELECT a.id, a.text, i.name as ing_name FROM ingredient_aliases a JOIN ingredients i ON i.id = a.ingredient_id WHERE i.deleted_at IS NOT NULL LIMIT 10"
  );
  console.log("Sample orphans (first 10):");
  for (const r of sample) {
    console.log('  - text="' + r.text + '" ingredient="' + r.ing_name + '"');
  }

  const deleted = await prisma.$executeRawUnsafe(
    "DELETE FROM ingredient_aliases WHERE ingredient_id IN (SELECT id FROM ingredients WHERE deleted_at IS NOT NULL)"
  );
  console.log("Deleted " + deleted + " orphaned alias row(s)");

  const after = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS cnt FROM ingredient_aliases WHERE ingredient_id IN (SELECT id FROM ingredients WHERE deleted_at IS NOT NULL)"
  );
  if (after[0].cnt !== 0) {
    throw new Error("VERIFY FAILED: " + after[0].cnt + " orphans still remain");
  }
  console.log("Verified: 0 orphans remain");

  const activeAliases = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS cnt FROM ingredient_aliases"
  );
  console.log("Active aliases intact: " + activeAliases[0].cnt);

  await prisma.$disconnect();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
