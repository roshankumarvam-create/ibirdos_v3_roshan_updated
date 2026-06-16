// P0 Sprint: additive schema changes from commits 3a00e0b–53861fd
//
// Three changes (all purely additive — zero drops):
//   1. CREATE TYPE daily_sales_status (NO_BUSINESS | CLOSED_WON | LOST | FOLLOW_UP)
//   2. ALTER TYPE tender_type ADD VALUE for: VISA, MASTERCARD, AMEX, DISCOVER, CHECK, ACH_INVOICE
//   3. ALTER TABLE daily_sales ADD COLUMN status daily_sales_status DEFAULT 'NO_BUSINESS'
//
// Run:
//   node packages/db/migrations/p0-sprint-daily-sales-status.js
//
// For production override the URL:
//   DATABASE_URL="postgresql://..." node packages/db/migrations/p0-sprint-daily-sales-status.js
//
// Fully idempotent — safe to re-run.

"use strict";

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function typeExists(typeName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_type WHERE typname = $1
       AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
     LIMIT 1`,
    typeName,
  );
  return rows.length > 0;
}

async function enumValueExists(typeName, value) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_enum
      WHERE enumlabel = $1
        AND enumtypid = (
          SELECT oid FROM pg_type
           WHERE typname = $2
             AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        )
      LIMIT 1`,
    value,
    typeName,
  );
  return rows.length > 0;
}

async function columnExists(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = $1
        AND column_name  = $2
      LIMIT 1`,
    tableName,
    columnName,
  );
  return rows.length > 0;
}

function header(msg) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${msg}`);
  console.log(`${"─".repeat(60)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  P0 Sprint: daily_sales_status + tender_type addendum   ║");
  console.log("║  ADDITIVE ONLY — zero drops, zero destructive changes   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // ── Preflight: confirm we can connect ────────────────────────────────────
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    console.log("\n✓ Database connection OK");
  } catch (e) {
    console.error("\n✗ Cannot connect to database:", e.message);
    console.error("  Set DATABASE_URL env var to the production URL.");
    process.exit(1);
  }

  let applied = 0;
  let skipped = 0;

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — CREATE TYPE daily_sales_status
  // ─────────────────────────────────────────────────────────────────────────
  header("Step 1: CREATE TYPE daily_sales_status");

  if (await typeExists("daily_sales_status")) {
    console.log("  — daily_sales_status already exists, skipping");
    skipped++;
  } else {
    await prisma.$executeRawUnsafe(
      `CREATE TYPE daily_sales_status AS ENUM (
        'NO_BUSINESS', 'CLOSED_WON', 'LOST', 'FOLLOW_UP'
      )`,
    );
    console.log("  ✓ CREATED TYPE daily_sales_status");
    applied++;
  }

  // Verify
  const statusTypeOk = await typeExists("daily_sales_status");
  if (!statusTypeOk) throw new Error("VERIFY FAILED: daily_sales_status type not found after CREATE");
  // Check all four values are present
  const expectedStatusValues = ["NO_BUSINESS", "CLOSED_WON", "LOST", "FOLLOW_UP"];
  for (const v of expectedStatusValues) {
    if (!(await enumValueExists("daily_sales_status", v))) {
      throw new Error(`VERIFY FAILED: daily_sales_status missing value '${v}'`);
    }
  }
  console.log(`  ✓ Verified: daily_sales_status has all 4 values (${expectedStatusValues.join(", ")})`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — ADD VALUES to tender_type
  // ─────────────────────────────────────────────────────────────────────────
  header("Step 2: ALTER TYPE tender_type ADD VALUE (×6)");

  if (!(await typeExists("tender_type"))) {
    throw new Error("SAFETY STOP: tender_type enum does not exist — expected it to already be in production schema. Aborting.");
  }

  const newTenderValues = ["VISA", "MASTERCARD", "AMEX", "DISCOVER", "CHECK", "ACH_INVOICE"];

  for (const val of newTenderValues) {
    if (await enumValueExists("tender_type", val)) {
      console.log(`  — tender_type.'${val}' already exists, skipping`);
      skipped++;
    } else {
      // NOTE: ALTER TYPE ADD VALUE cannot run inside an explicit transaction on
      // Postgres < 12. $executeRawUnsafe does NOT auto-start a transaction.
      // On Postgres 12+ (Railway default) this is fully safe.
      await prisma.$executeRawUnsafe(`ALTER TYPE tender_type ADD VALUE '${val}'`);
      console.log(`  ✓ ALTER TYPE tender_type ADD VALUE '${val}'`);
      applied++;
    }
  }

  // Verify all 6 new values
  for (const val of newTenderValues) {
    if (!(await enumValueExists("tender_type", val))) {
      throw new Error(`VERIFY FAILED: tender_type missing value '${val}' after ADD VALUE`);
    }
  }
  console.log(`  ✓ Verified: tender_type has all 6 new values`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3 — ADD COLUMN daily_sales.status
  // ─────────────────────────────────────────────────────────────────────────
  header("Step 3: ALTER TABLE daily_sales ADD COLUMN status");

  if (!(await typeExists("daily_sales_status"))) {
    throw new Error("SAFETY STOP: daily_sales_status type still missing — cannot add column. Aborting.");
  }

  if (await columnExists("daily_sales", "status")) {
    console.log("  — daily_sales.status already exists, skipping");
    skipped++;
  } else {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE daily_sales
         ADD COLUMN status daily_sales_status NOT NULL DEFAULT 'NO_BUSINESS'`,
    );
    console.log("  ✓ ALTER TABLE daily_sales ADD COLUMN status daily_sales_status NOT NULL DEFAULT 'NO_BUSINESS'");
    applied++;
  }

  // Verify column
  if (!(await columnExists("daily_sales", "status"))) {
    throw new Error("VERIFY FAILED: status column not found on daily_sales after ALTER TABLE");
  }
  console.log("  ✓ Verified: daily_sales.status column exists");

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4 — ADD VALUE 'VENDOR_PRICE_CHANGE' to insight_kind
  // ─────────────────────────────────────────────────────────────────────────
  header("Step 4: ALTER TYPE insight_kind ADD VALUE 'VENDOR_PRICE_CHANGE'");

  if (!(await typeExists("insight_kind"))) {
    throw new Error("SAFETY STOP: insight_kind enum does not exist — expected it in production schema. Aborting.");
  }

  if (await enumValueExists("insight_kind", "VENDOR_PRICE_CHANGE")) {
    console.log("  — insight_kind.'VENDOR_PRICE_CHANGE' already exists, skipping");
    skipped++;
  } else {
    await prisma.$executeRawUnsafe(`ALTER TYPE insight_kind ADD VALUE 'VENDOR_PRICE_CHANGE'`);
    console.log("  ✓ ALTER TYPE insight_kind ADD VALUE 'VENDOR_PRICE_CHANGE'");
    applied++;
  }

  if (!(await enumValueExists("insight_kind", "VENDOR_PRICE_CHANGE"))) {
    throw new Error("VERIFY FAILED: insight_kind missing 'VENDOR_PRICE_CHANGE' after ADD VALUE");
  }
  console.log("  ✓ Verified: insight_kind contains 'VENDOR_PRICE_CHANGE'");

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5 — Sanity-check existing rows
  // ─────────────────────────────────────────────────────────────────────────
  header("Step 5: Sanity check — existing daily_sales rows");

  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, sale_date::text, status FROM daily_sales ORDER BY entered_at LIMIT 10`,
  );
  if (rows.length === 0) {
    console.log("  — No rows in daily_sales (expected for a fresh workspace)");
  } else {
    console.log(`  Existing ${rows.length} row(s) — all should show status = NO_BUSINESS:`);
    for (const r of rows) {
      const ok = r.status === "NO_BUSINESS" ? "✓" : "⚠";
      console.log(`    ${ok} id=${r.id.slice(0, 8)}… sale_date=${r.sale_date}  status=${r.status}`);
      if (r.status !== "NO_BUSINESS") {
        throw new Error(`VERIFY FAILED: row ${r.id} has unexpected status '${r.status}' (should be NO_BUSINESS for all pre-existing rows)`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 6 — Final report
  // ─────────────────────────────────────────────────────────────────────────
  header("Migration complete");
  console.log(`  Applied : ${applied}`);
  console.log(`  Skipped : ${skipped} (already present)`);
  console.log(`  Dropped : 0`);
  console.log(`  Errors  : 0`);
  console.log("");
  console.log("  Next step for production:");
  console.log("    DATABASE_URL=\"<railway-postgres-url>\" node packages/db/migrations/p0-sprint-daily-sales-status.js");
  console.log("");
  console.log("  After applying, Prisma client is already regenerated (schema.prisma updated).");
  console.log("  Redeploy the API to Railway so the new NestJS code picks up the column.");
}

main()
  .catch((e) => {
    console.error("\n\n✗ MIGRATION FAILED:", e.message);
    console.error(e.stack);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
