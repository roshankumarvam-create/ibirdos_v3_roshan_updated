import { requireSession } from "@/lib/session";
import { InsightsList } from "@/components/dashboard/insights-list";

export default async function InsightsPage() {
  const user = await requireSession();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">AI insights</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">Daily scans for margin erosion, price spikes, waste patterns, vendor opportunities</p>
      </header>
      <InsightsList workspaceSlug={user.workspaceSlug} />
    </div>
  );
}
