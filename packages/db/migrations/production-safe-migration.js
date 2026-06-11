// Safe additive migration — checks before creating, zero drops.
// Run: node packages/db/migrations/production-safe-migration.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function typeExists(typeName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_type WHERE typname = $1 AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') LIMIT 1`,
    typeName,
  );
  return rows && rows.length > 0;
}

async function tableExists(tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    tableName,
  );
  return rows && rows.length > 0;
}

async function indexExists(indexName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1 LIMIT 1`,
    indexName,
  );
  return rows && rows.length > 0;
}

async function main() {
  console.log("=== Production Safe Migration ===\n");

  // ── Step 1: Create missing enum types ──────────────────────────────────────
  console.log("Step 1: Creating missing enum types...");

  if (!(await typeExists("tender_type"))) {
    await prisma.$executeRawUnsafe(
      `CREATE TYPE tender_type AS ENUM ('CASH','CREDIT_CARD','DEBIT_CARD','GIFT_CARD','ONLINE_PAYMENT','DELIVERY_APP','CATERING_INVOICE','HOUSE_ACCOUNT','OTHER')`,
    );
    console.log("  ✓ Created enum tender_type");
  } else {
    console.log("  — tender_type already exists");
  }

  if (!(await typeExists("fixed_cost_category"))) {
    await prisma.$executeRawUnsafe(
      `CREATE TYPE fixed_cost_category AS ENUM ('RENT','UTILITIES','INSURANCE','EQUIPMENT_LEASE','OTHER')`,
    );
    console.log("  ✓ Created enum fixed_cost_category");
  } else {
    console.log("  — fixed_cost_category already exists");
  }

  // ── Step 2: Create new tables ───────────────────────────────────────────────
  console.log("\nStep 2: Creating new tables...");

  if (!(await tableExists("daily_sales"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE daily_sales (
        id                 TEXT           NOT NULL PRIMARY KEY,
        workspace_id       TEXT           NOT NULL REFERENCES workspaces(id),
        sale_date          DATE           NOT NULL,
        gross_sales        NUMERIC(12,2)  NOT NULL,
        net_sales          NUMERIC(12,2)  NOT NULL,
        tax                NUMERIC(12,2)  NOT NULL,
        discounts          NUMERIC(12,2)  NOT NULL DEFAULT 0,
        voids              NUMERIC(12,2)  NOT NULL DEFAULT 0,
        refunds            NUMERIC(12,2)  NOT NULL DEFAULT 0,
        catering_sales     NUMERIC(12,2)  NOT NULL DEFAULT 0,
        online_sales       NUMERIC(12,2)  NOT NULL DEFAULT 0,
        delivery_app_sales NUMERIC(12,2)  NOT NULL DEFAULT 0,
        entered_by_id      TEXT           NOT NULL REFERENCES users(id),
        entered_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        source_file_url    TEXT,
        notes              TEXT,
        UNIQUE(workspace_id, sale_date)
      )
    `);
    console.log("  ✓ Created table daily_sales");
  } else {
    console.log("  — daily_sales already exists");
  }

  if (!(await tableExists("tender_entries"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE tender_entries (
        id             TEXT          NOT NULL PRIMARY KEY,
        daily_sales_id TEXT          NOT NULL REFERENCES daily_sales(id) ON DELETE CASCADE,
        workspace_id   TEXT          NOT NULL,
        tender_type    tender_type   NOT NULL,
        amount         NUMERIC(12,2) NOT NULL,
        count          INT           NOT NULL DEFAULT 0
      )
    `);
    console.log("  ✓ Created table tender_entries");
  } else {
    console.log("  — tender_entries already exists");
  }

  if (!(await tableExists("labor_entries"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE labor_entries (
        id           TEXT          NOT NULL PRIMARY KEY,
        workspace_id TEXT          NOT NULL REFERENCES workspaces(id),
        work_date    DATE          NOT NULL,
        hours        NUMERIC(8,2)  NOT NULL,
        labor_cost   NUMERIC(12,2) NOT NULL,
        category     TEXT,
        notes        TEXT
      )
    `);
    console.log("  ✓ Created table labor_entries");
  } else {
    console.log("  — labor_entries already exists");
  }

  if (!(await tableExists("fixed_costs"))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE fixed_costs (
        id             TEXT                NOT NULL PRIMARY KEY,
        workspace_id   TEXT                NOT NULL REFERENCES workspaces(id),
        name           TEXT                NOT NULL,
        monthly_amount NUMERIC(12,2)       NOT NULL,
        category       fixed_cost_category NOT NULL,
        active         BOOLEAN             NOT NULL DEFAULT true
      )
    `);
    console.log("  ✓ Created table fixed_costs");
  } else {
    console.log("  — fixed_costs already exists");
  }

  // ── Step 3: Create indexes ──────────────────────────────────────────────────
  console.log("\nStep 3: Creating indexes...");

  const indexes = [
    ["daily_sales_workspace_id_sale_date_idx",      "CREATE INDEX daily_sales_workspace_id_sale_date_idx ON daily_sales(workspace_id, sale_date)"],
    ["tender_entries_workspace_id_tender_type_idx", "CREATE INDEX tender_entries_workspace_id_tender_type_idx ON tender_entries(workspace_id, tender_type)"],
    ["labor_entries_workspace_id_work_date_idx",    "CREATE INDEX labor_entries_workspace_id_work_date_idx ON labor_entries(workspace_id, work_date)"],
    ["fixed_costs_workspace_id_category_idx",       "CREATE INDEX fixed_costs_workspace_id_category_idx ON fixed_costs(workspace_id, category)"],
  ];

  for (const [name, sql] of indexes) {
    if (!(await indexExists(name))) {
      await prisma.$executeRawUnsafe(sql);
      console.log(`  ✓ Created index ${name}`);
    } else {
      console.log(`  — ${name} already exists`);
    }
  }

  console.log("\n=== Migration complete — ZERO tables dropped, only additive changes ===");
}

main()
  .catch((e) => { console.error("MIGRATION FAILED:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
