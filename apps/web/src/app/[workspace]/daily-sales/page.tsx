import { requireSession } from "@/lib/session";
import { DailySalesList } from "@/components/daily-sales/daily-sales-list";

export default async function DailySalesPage() {
  const user = await requireSession();
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Daily Sales</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            End-of-day sales totals and tender reconciliation
          </p>
        </div>
        <a
          href={`/${user.workspaceSlug}/daily-sales/new`}
          className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-bg-base hover:bg-accent-400 transition-colors"
        >
          + New entry
        </a>
      </header>
      <DailySalesList workspaceSlug={user.workspaceSlug} />
    </div>
  );
}
