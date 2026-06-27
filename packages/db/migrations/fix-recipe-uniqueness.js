// =====================================================================
// fix-recipe-uniqueness.js
// Converts the full unique index on recipes(workspace_id, name) into a
// partial unique index that only covers active (non-deleted) rows.
// This allows soft-deleted recipe names to be reused on re-import.
//
// Run from packages/db/ directory:
//   cd packages/db
//   node migrations/fix-recipe-uniqueness.js
// =====================================================================

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set"); process.exit(1);
  }

  // PRE-STATE
  const preActive = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS cnt FROM recipes WHERE deleted_at IS NULL"
  );
  const preSoftDeleted = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS cnt FROM recipes WHERE deleted_at IS NOT NULL"
  );
  console.log("Pre-state: active=" + preActive[0].cnt + ", soft-deleted=" + preSoftDeleted[0].cnt);

  // MIGRATION
  await prisma.$transaction([
    prisma.$executeRawUnsafe("DROP INDEX IF EXISTS recipes_workspace_id_name_key"),
    prisma.$executeRawUnsafe(
      "CREATE UNIQUE INDEX IF NOT EXISTS recipes_workspace_id_name_active_unique " +
      "ON recipes (workspace_id, name) WHERE deleted_at IS NULL"
    ),
    prisma.$executeRawUnsafe(
      "DELETE FROM recipe_ingredients WHERE recipe_id IN (" +
      "SELECT id FROM recipes WHERE deleted_at IS NOT NULL " +
      "AND LOWER(name) LIKE '%cajun chicken wing%')"
    ),
    prisma.$executeRawUnsafe(
      "DELETE FROM recipes WHERE deleted_at IS NOT NULL " +
      "AND LOWER(name) LIKE '%cajun chicken wing%'"
    ),
  ]);
  console.log("Migration transaction committed.");

  // POST-STATE SMOKE TESTS
  const oldIndex = await prisma.$queryRawUnsafe(
    "SELECT indexname FROM pg_indexes WHERE indexname = 'recipes_workspace_id_name_key'"
  );
  if (oldIndex.length > 0) throw new Error("Old index still exists");

  const newIndex = await prisma.$queryRawUnsafe(
    "SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'recipes_workspace_id_name_active_unique'"
  );
  if (newIndex.length === 0) throw new Error("New partial index not created");
  if (!newIndex[0].indexdef.toLowerCase().includes("where (deleted_at is null)")) {
    throw new Error("New index missing WHERE clause: " + newIndex[0].indexdef);
  }
  console.log("Verified: " + newIndex[0].indexdef);

  const remainingCajun = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS cnt FROM recipes " +
    "WHERE deleted_at IS NOT NULL AND LOWER(name) LIKE '%cajun chicken wing%'"
  );
  if (remainingCajun[0].cnt !== 0) throw new Error("Cajun cleanup incomplete");

  const postActive = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS cnt FROM recipes WHERE deleted_at IS NULL"
  );
  if (postActive[0].cnt !== preActive[0].cnt) {
    throw new Error("Active recipe count changed! pre=" + preActive[0].cnt + " post=" + postActive[0].cnt);
  }
  console.log("All smoke tests passed.");
  console.log("Active recipes: " + postActive[0].cnt + " (unchanged)");
  console.log("Migration complete.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
