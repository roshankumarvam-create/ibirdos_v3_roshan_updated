// Run with: node packages/db/migrations/add-daily-sales-tender.js
// Requires DATABASE_URL in environment.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TYPE IF NOT EXISTS tender_type AS ENUM (
      'CASH','CREDIT_CARD','DEBIT_CARD','GIFT_CARD','ONLINE_PAYMENT',
      'DELIVERY_APP','CATERING_INVOICE','HOUSE_ACCOUNT','OTHER'
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS daily_sales (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      sale_date DATE NOT NULL,
      gross_sales NUMERIC(12,2) NOT NULL,
      net_sales NUMERIC(12,2) NOT NULL,
      tax NUMERIC(12,2) NOT NULL,
      discounts NUMERIC(12,2) NOT NULL DEFAULT 0,
      voids NUMERIC(12,2) NOT NULL DEFAULT 0,
      refunds NUMERIC(12,2) NOT NULL DEFAULT 0,
      catering_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
      online_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
      delivery_app_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
      entered_by_id TEXT NOT NULL REFERENCES users(id),
      entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source_file_url TEXT,
      notes TEXT,
      UNIQUE(workspace_id, sale_date)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS daily_sales_ws_date ON daily_sales(workspace_id, sale_date)`
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tender_entries (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      daily_sales_id TEXT NOT NULL REFERENCES daily_sales(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      tender_type tender_type NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      count INT NOT NULL DEFAULT 0
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS tender_entries_ws_type ON tender_entries(workspace_id, tender_type)`
  );
  console.log("Migration complete: daily_sales and tender_entries tables created");
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
