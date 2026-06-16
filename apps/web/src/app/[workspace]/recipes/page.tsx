import Link from "next/link";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, Badge, Button, EmptyState } from "@ibirdos/ui";
import { formatCents, formatPct } from "@/lib/format";

interface RecipeListItem {
  id: string;
  name: string;
  category: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  portionsYielded: number | null;
  salePriceCents: number | null;
  // Live cost — always current; source of truth
  liveCostCents: number;
  livePerPortionCostCents: number | null;
  liveFoodCostPct: number | null;
  liveMarginPct: number | null;
  liveStaleness: "FRESH" | "MISSING_PRICE" | "MISSING_INGREDIENT";
  autoReprice: boolean;
  // Cached — backup, may lag briefly after ingredient price changes
  cachedCostCents: number | null;
  cachedCostUpdatedAt: string | null;
  costStaleness: string;
  ingredientCount: number;
}

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-bg-inset text-text-tertiary border border-bg-border">—</span>;
  }
  if (pct <= 30) {
    return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-success/10 text-success border border-success/20">OK</span>;
  }
  if (pct <= 35) {
    return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-warning/10 text-warning border border-warning/20">WATCH</span>;
  }
  return <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-danger/10 text-danger border border-danger/20">HIGH</span>;
}

function fmtRelTime(iso: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string }> }) {
  const user = await requireSession();
  const sp = await searchParams;
  const c = await cookies();

  const qs = new URLSearchParams();
  if (sp.search) qs.set("search", sp.search);
  if (sp.status) qs.set("status", sp.status);
  qs.set("limit", "100");

  const res = await api.get<{ items: RecipeListItem[] }>(`/recipes?${qs.toString()}`, { cookies: c });
  const items = res.data?.items ?? [];

  const canCreate = user.role !== "STAFF";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Recipes</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {items.length} recipe{items.length === 1 ? "" : "s"} · costs computed live from current ingredient prices
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Link href={`/${user.workspaceSlug}/recipes/import` as any}>
              <Button variant="secondary">Import CSV/Excel</Button>
            </Link>
            <Link href={`/${user.workspaceSlug}/recipes/new` as any}>
              <Button>+ New recipe</Button>
            </Link>
          </div>
        )}
      </header>

      <form className="flex gap-2">
        <input
          name="search"
          defaultValue={sp.search ?? ""}
          placeholder="Search recipes…"
          className="w-72 rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          className="rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm focus:outline-none focus:border-accent-500/60"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <Button variant="secondary" type="submit">Filter</Button>
      </form>

      <Card>
        {items.length === 0 ? (
          <EmptyState title="No recipes yet" description="Create your first recipe to see live costs and margins." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Name</th>
                <th className="text-left px-5 py-3 font-medium">Category</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3 font-medium">Portions</th>
                <th className="text-right px-5 py-3 font-medium">Live cost</th>
                <th className="text-right px-5 py-3 font-medium">Sale</th>
                <th className="text-right px-5 py-3 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {items.map((r) => {
                const cacheTs = fmtRelTime(r.cachedCostUpdatedAt);
                return (
                  <tr key={r.id} className="hover:bg-bg-hover/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/${user.workspaceSlug}/recipes/${r.id}` as any} className="text-text-primary hover:text-accent-500">
                          {r.name}
                        </Link>
                        <MarginBadge pct={r.liveFoodCostPct} />
                        {!r.autoReprice && r.liveFoodCostPct != null && r.liveFoodCostPct > 35 && (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-bg-inset text-text-tertiary border border-bg-border">LOCKED</span>
                        )}
                        {r.liveStaleness === "MISSING_PRICE" && (
                          <Badge tone="warning" className="text-[10px]">missing price</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-text-secondary text-xs">{r.category ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Badge tone={r.status === "ACTIVE" ? "success" : "neutral"}>
                        {r.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{r.portionsYielded ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span title={cacheTs ? `Cache updated ${cacheTs}` : undefined}>
                        {formatCents(r.liveCostCents)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{formatCents(r.salePriceCents)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span className={r.liveMarginPct == null ? "text-text-tertiary" :
                        r.liveMarginPct < 30 ? "text-danger" :
                        r.liveMarginPct < 50 ? "text-warning" : "text-success"}>
                        {r.liveMarginPct != null ? `${r.liveMarginPct.toFixed(1)}%` : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
