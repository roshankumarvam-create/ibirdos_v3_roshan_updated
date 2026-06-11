// Run with: node packages/db/migrations/add-vendor-price-change-insight.js
// Requires DATABASE_URL in environment.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TYPE insight_kind ADD VALUE IF NOT EXISTS 'VENDOR_PRICE_CHANGE'`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS match_status TEXT`,
  );
  console.log("Migration complete: added VENDOR_PRICE_CHANGE to insight_kind, match_status to ingredients");
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
