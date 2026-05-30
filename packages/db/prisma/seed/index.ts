// =====================================================================
// Seed script — billing plans + reference data.
// =====================================================================
// Run with: pnpm --filter @ibirdos/db run seed
//
// Idempotent: uses upsert. Safe to run on existing prod data.
// Replace stripePrice*Id with real values from your Stripe dashboard
// before going live (or rely on the env-driven product setup).
// =====================================================================
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding billing plan catalog…");

  await prisma.billingPlanCatalog.upsert({
    where: { plan: "STARTER" },
    create: {
      plan: "STARTER",
      displayName: "Starter",
      stripePriceMonthlyId: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? null,
      stripePriceYearlyId: process.env.STRIPE_PRICE_STARTER_YEARLY ?? null,
      unitAmountMonthlyCents: 4900,   // $49 / seat / mo
      unitAmountYearlyCents: 49_000,  // ~17% off
      seatIncluded: 5,
      features: { invoiceOcr: true, recipeManagement: true, basicAnalytics: true, vendorIntegrations: false },
    },
    update: {},
  });
  await prisma.billingPlanCatalog.upsert({
    where: { plan: "GROWTH" },
    create: {
      plan: "GROWTH", displayName: "Growth",
      stripePriceMonthlyId: process.env.STRIPE_PRICE_GROWTH_MONTHLY ?? null,
      stripePriceYearlyId: process.env.STRIPE_PRICE_GROWTH_YEARLY ?? null,
      unitAmountMonthlyCents: 9900,
      unitAmountYearlyCents: 99_000,
      seatIncluded: 25,
      features: { invoiceOcr: true, recipeManagement: true, basicAnalytics: true, advancedAnalytics: true, vendorIntegrations: true, aiInsights: true },
    },
    update: {},
  });
  await prisma.billingPlanCatalog.upsert({
    where: { plan: "SCALE" },
    create: {
      plan: "SCALE", displayName: "Scale",
      stripePriceMonthlyId: process.env.STRIPE_PRICE_SCALE_MONTHLY ?? null,
      stripePriceYearlyId: process.env.STRIPE_PRICE_SCALE_YEARLY ?? null,
      unitAmountMonthlyCents: 19900,
      unitAmountYearlyCents: 199_000,
      seatIncluded: 999,
      features: { invoiceOcr: true, recipeManagement: true, basicAnalytics: true, advancedAnalytics: true, vendorIntegrations: true, aiInsights: true, prioritySupport: true, sso: true },
    },
    update: {},
  });
  await prisma.billingPlanCatalog.upsert({
    where: { plan: "ENTERPRISE" },
    create: {
      plan: "ENTERPRISE", displayName: "Enterprise",
      stripePriceMonthlyId: null, stripePriceYearlyId: null,
      unitAmountMonthlyCents: 0, unitAmountYearlyCents: 0,
      seatIncluded: 9999,
      features: { everythingInScale: true, customContract: true, dedicatedCsm: true, slaUptime: "99.95" },
    },
    update: {},
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
