// Run with: node packages/db/migrations/add-invoice-line-gtin-status.js
// Requires DATABASE_URL in environment.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    "ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS gtin TEXT",
  );
  await prisma.$executeRawUnsafe(
    "ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS line_status TEXT",
  );
  console.log("Migration complete: added gtin and line_status to invoice_lines");
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
