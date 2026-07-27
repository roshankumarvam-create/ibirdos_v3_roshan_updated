import { requireSession } from "@/lib/session";

// #5: these two are invoice-purchases-based, not true COGS/prime cost
// (COGS needs beginning/ending inventory valuation, which this app
// doesn't track) -- labeled "Purchases" accordingly, never "Food Cost" or
// "Prime Cost". See the comment on ReportsService.getFoodCostVsSales.
const REPORTS = [
  { href: "food-cost",           title: "Purchases vs Sales",    description: "Invoice purchases as % of net sales (not full COGS)" },
  { href: "labor-cost",          title: "Labor Cost vs Sales",   description: "Labor spend as % of net sales" },
  { href: "prime-cost",          title: "Purchases + Labor",     description: "Combined purchases + labor as % of net sales (not true prime cost)" },
  { href: "vendor-price-changes", title: "Vendor Price Changes", description: "Ingredient price movements by vendor" },
  { href: "vendor-aging",        title: "Vendor Aging",          description: "Unpaid invoices by aging bucket" },
];

export default async function ReportsIndexPage() {
  const user = await requireSession();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">
          KPI reports built on daily sales, invoices, and events
        </p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <a
            key={r.href}
            href={`/${user.workspaceSlug}/reports/${r.href}`}
            className="rounded-md border border-bg-border bg-bg-surface p-5 hover:border-accent-500/50 hover:bg-bg-hover/30 transition-colors"
          >
            <div className="font-medium text-text-primary">{r.title}</div>
            <div className="mt-1 text-xs text-text-secondary">{r.description}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
