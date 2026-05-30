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
  cachedCostCents: number | null;
  cachedMarginPct: number | null;
  costStaleness: string;
  ingredientCount: number;
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
            {items.length} recipe{items.length === 1 ? "" : "s"} · costs auto-recalculate on ingredient price changes
          </p>
        </div>
        {canCreate && (
          <Link href={`/${user.workspaceSlug}/recipes/new` as any}>
            <Button>+ New recipe</Button>
          </Link>
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
                <th className="text-right px-5 py-3 font-medium">Cost</th>
                <th className="text-right px-5 py-3 font-medium">Sale</th>
                <th className="text-right px-5 py-3 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {items.map((r) => (
                <tr key={r.id} className="hover:bg-bg-hover/30 transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/${user.workspaceSlug}/recipes/${r.id}` as any} className="text-text-primary hover:text-accent-500">
                      {r.name}
                    </Link>
                    {r.costStaleness === "COMPUTE_ERROR" && (
                      <Badge tone="danger" className="ml-2 text-[10px]">cost error</Badge>
                    )}
                    {r.costStaleness === "STALE" && (
                      <Badge tone="warning" className="ml-2 text-[10px]">recalc pending</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-text-secondary text-xs">{r.category ?? "—"}</td>
                  <td className="px-5 py-3">
                    <Badge tone={r.status === "ACTIVE" ? "success" : r.status === "DRAFT" ? "neutral" : "neutral"}>
                      {r.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{r.portionsYielded ?? "—"}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatCents(r.cachedCostCents)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{formatCents(r.salePriceCents)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className={r.cachedMarginPct == null ? "text-text-tertiary" :
                      r.cachedMarginPct < 30 ? "text-danger" :
                      r.cachedMarginPct < 50 ? "text-warning" : "text-success"}>
                      {formatPct(r.cachedMarginPct)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
