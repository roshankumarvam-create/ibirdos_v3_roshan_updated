// Run with: node packages/db/migrations/add-labor-fixed-costs.js
// Requires DATABASE_URL in environment.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TYPE IF NOT EXISTS fixed_cost_category AS ENUM (
      'RENT','UTILITIES','INSURANCE','EQUIPMENT_LEASE','OTHER'
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS labor_entries (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      work_date DATE NOT NULL,
      hours NUMERIC(8,2) NOT NULL,
      labor_cost NUMERIC(12,2) NOT NULL,
      category TEXT,
      notes TEXT
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS labor_entries_ws_date ON labor_entries(workspace_id, work_date)`
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS fixed_costs (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      monthly_amount NUMERIC(12,2) NOT NULL,
      category fixed_cost_category NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS fixed_costs_ws_cat ON fixed_costs(workspace_id, category)`
  );
  console.log("Migration complete: labor_entries and fixed_costs tables created");
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
