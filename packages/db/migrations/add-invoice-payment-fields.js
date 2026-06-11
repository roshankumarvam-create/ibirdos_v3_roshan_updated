// Migration: add paidDate, balanceDue to Invoice; OVERDUE to invoice_payment_status enum
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS paid_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS balance_due DECIMAL(12,2) NOT NULL DEFAULT 0;
  `);
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'OVERDUE'
                     AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'invoice_payment_status')) THEN
        ALTER TYPE invoice_payment_status ADD VALUE 'OVERDUE';
      END IF;
    END $$;
  `);
  console.log("Migration add-invoice-payment-fields complete.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
