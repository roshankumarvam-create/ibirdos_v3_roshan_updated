// =====================================================================
// cleanup-test-recipe.js
// Hard-deletes soft-deleted "Cajun Chicken Wings" recipe + its children.
// Run from packages/db/ directory:
//   cd packages/db
//   node migrations/cleanup-test-recipe.js
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

  const targets = await prisma.$queryRawUnsafe(
    "SELECT id, name, workspace_id, deleted_at FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NOT NULL"
  );
  console.log("Found " + targets.length + " soft-deleted recipe(s) named Cajun Chicken Wings");

  if (targets.length === 0) {
    const active = await prisma.$queryRawUnsafe(
      "SELECT id FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NULL"
    );
    if (active.length > 0) {
      console.log("Active recipe still exists. Delete it from UI first.");
    } else {
      console.log("No recipes with this name. Re-import should work.");
    }
    await prisma.$disconnect();
    return;
  }

  const linksDeleted = await prisma.$executeRawUnsafe(
    "DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NOT NULL)"
  );
  console.log("Deleted " + linksDeleted + " recipe_ingredient row(s)");

  const recipesDeleted = await prisma.$executeRawUnsafe(
    "DELETE FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NOT NULL"
  );
  console.log("Deleted " + recipesDeleted + " recipe row(s)");

  const remaining = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS cnt FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NOT NULL"
  );
  if (remaining[0].cnt !== 0) {
    throw new Error("VERIFY FAILED: " + remaining[0].cnt + " rows still remain");
  }
  console.log("Verified: 0 soft-deleted Cajun Chicken Wings remain");

  await prisma.$disconnect();
  console.log("Cleanup complete. You can re-import the XLSX.");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
