const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const tables = [
    "daily_sales", "tender_entries", "labor_entries", "fixed_costs",
    "users", "workspaces", "invoices", "sessions", "audit_logs",
    "invoice_lines", "vendors", "memberships",
  ];
  console.log("=== Table Verification ===");
  let allOk = true;
  for (const t of tables) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS cnt FROM "${t}"`);
      console.log(`  ✓ ${t}: ${rows[0].cnt} rows`);
    } catch (e) {
      console.log(`  ✗ ${t}: ERROR — ${e.message}`);
      allOk = false;
    }
  }
  console.log(allOk ? "\nAll tables OK!" : "\nSome tables MISSING!");
  if (!allOk) process.exit(1);
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
