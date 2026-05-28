import { requireSession } from "@/lib/session";
import { KitchenBoard } from "@/components/dashboard/kitchen-board";

export default async function KitchenPage() {
  const user = await requireSession();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Kitchen command center</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">Realtime · drag tasks across stations · auto-updates when events change</p>
      </header>
      <KitchenBoard workspaceSlug={user.workspaceSlug} />
    </div>
  );
}
