// =====================================================================
// packages/db/migrations/install-pg-trgm.js
//
// Installs the pg_trgm Postgres extension needed for fuzzy ingredient
// matching (similarity() function). ADDITIVE — does not modify data.
//
// Run ONCE against production:
//   $env:DATABASE_URL = "<production DATABASE_PUBLIC_URL>"
//   node packages/db/migrations/install-pg-trgm.js
// =====================================================================

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Install pg_trgm extension (fuzzy text match)   ║");
  console.log("║  ADDITIVE — does not modify existing data        ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // Check current state
  const before = await prisma.$queryRawUnsafe(
    `SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';`,
  );

  if (before.length > 0) {
    console.log(`\n✓ pg_trgm already installed (v${before[0].extversion}) — no action needed.`);
  } else {
    console.log("\nInstalling pg_trgm extension...");
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    const after = await prisma.$queryRawUnsafe(
      `SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';`,
    );
    console.log(`✓ pg_trgm installed:`, after[0]);
  }

  // GIN trigram indexes (IF NOT EXISTS is idempotent)
  console.log("\nEnsuring GIN trigram indexes...");
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ingredients_name_trgm
      ON ingredients USING GIN (LOWER(name) gin_trgm_ops);
  `);
  console.log("  ✓ idx_ingredients_name_trgm");

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_ingredient_aliases_text_trgm
      ON ingredient_aliases USING GIN (text gin_trgm_ops);
  `);
  console.log("  ✓ idx_ingredient_aliases_text_trgm");

  // Verify the function works
  const test = await prisma.$queryRawUnsafe(
    `SELECT similarity('chicken wing', 'chicken wings') AS sim;`,
  );
  console.log(`\n✓ similarity() function works: similarity('chicken wing', 'chicken wings') = ${test[0].sim}`);

  console.log("\n✓ Migration complete. Fuzzy ingredient matching is now active.");
}

main()
  .catch((e) => {
    console.error("\n✗ Migration failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
