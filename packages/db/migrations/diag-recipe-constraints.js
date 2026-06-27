// =====================================================================
// diag-recipe-constraints.js
// Read-only diagnostic: shows all constraints and indexes on recipes table.
// Run from packages/db/ directory:
//   cd packages/db
//   node migrations/diag-recipe-constraints.js
// =====================================================================

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set"); process.exit(1);
  }

  // Q1: all constraints on recipes table
  const cons = await prisma.$queryRawUnsafe(`
    SELECT con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'recipes' AND con.contype IN ('u','p')
    ORDER BY con.contype, con.conname;
  `);
  console.log("=== CONSTRAINTS on recipes ==="); for (const c of cons) console.log(c);

  // Q2: all indexes on recipes table
  const idx = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'recipes' ORDER BY indexname;
  `);
  console.log("\n=== INDEXES on recipes ==="); for (const i of idx) console.log(i);

  // Q3: soft-deleted recipes named anything-cajun
  const sd = await prisma.$queryRawUnsafe(`
    SELECT id, name, workspace_id, deleted_at
    FROM recipes WHERE LOWER(name) LIKE '%cajun%'
    ORDER BY deleted_at DESC NULLS LAST;
  `);
  console.log("\n=== Cajun-named recipes (any state) ===");
  for (const r of sd) console.log(r);

  // Q4: confirm schema.prisma view
  console.log("\n=== Schema reference ===");
  console.log("Check packages/db/prisma/schema.prisma for the Recipe model.");
  console.log("Look for @@unique or @@index involving name + workspaceId.");

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
