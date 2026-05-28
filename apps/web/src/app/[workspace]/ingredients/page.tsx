// =====================================================================
// apps/web/src/app/[workspace]/ingredients/page.tsx
// =====================================================================

import Link from "next/link";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, Badge, Button, EmptyState } from "@ibirdos/ui";
import type { IngredientDTO } from "@ibirdos/types";

interface ListResponse {
  items: IngredientDTO[];
  nextCursor: string | null;
}

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; category?: string }>;
}) {
  const user = await requireSession();
  const sp = await searchParams;
  const c = await cookies();

  const qs = new URLSearchParams();
  if (sp.search) qs.set("search", sp.search);
  if (sp.category) qs.set("category", sp.category);

  const res = await api.get<ListResponse>(
    `/ingredients?${qs.toString()}`,
    { cookies: c },
  );
  const items = res.data?.items ?? [];

  const canCreate = user.role === "OWNER" || user.role === "MANAGER";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ingredients</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {items.length} ingredient{items.length === 1 ? "" : "s"} · price changes auto-recalculate all recipes
          </p>
        </div>
        {canCreate && (
          <Link href={`/${user.workspaceSlug}/ingredients/new` as any}>
            <Button>+ Add ingredient</Button>
          </Link>
        )}
      </header>

      <form className="flex gap-2">
        <input
          type="search"
          name="search"
          defaultValue={sp.search ?? ""}
          placeholder="Search ingredients or aliases…"
          className="w-72 rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
        />
        <Button variant="secondary" type="submit">Search</Button>
      </form>

      <Card>
        {items.length === 0 ? (
          <EmptyState
            title="No ingredients yet"
            description={canCreate
              ? "Add your first ingredient manually, or import a vendor invoice (Phase 6) to populate automatically."
              : "Your manager hasn't added any ingredients yet."}
            action={canCreate ? (
              <Link href={`/${user.workspaceSlug}/ingredients/new` as any}>
                <Button>+ Add first ingredient</Button>
              </Link>
            ) : undefined}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Name</th>
                <th className="text-left px-5 py-3 font-medium">Category</th>
                <th className="text-left px-5 py-3 font-medium">Unit</th>
                <th className="text-right px-5 py-3 font-medium">Cost</th>
                <th className="text-right px-5 py-3 font-medium">Stock</th>
                <th className="text-left px-5 py-3 font-medium">Aliases</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {items.map((ing) => (
                <tr key={ing.id} className="hover:bg-bg-hover/30 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      href={`/${user.workspaceSlug}/ingredients/${ing.id}` as any}
                      className="text-text-primary hover:text-accent-500 transition-colors"
                    >
                      {ing.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone="neutral">{ing.category.toLowerCase().replace("_", " ")}</Badge>
                  </td>
                  <td className="px-5 py-3 text-text-secondary tabular-nums">
                    {ing.preferredDisplayUnit ?? ing.canonicalUnit}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {ing.currentCostCents != null
                      ? <span className="text-text-primary">${(ing.currentCostCents / 100).toFixed(4)}</span>
                      : <span className="text-text-tertiary">—</span>}
                    <span className="text-text-tertiary"> / {ing.canonicalUnit}</span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className={ing.reorderThresholdCanonical != null && ing.currentStockCanonical < ing.reorderThresholdCanonical
                      ? "text-warning"
                      : "text-text-secondary"}>
                      {ing.currentStockCanonical.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-text-tertiary text-xs">
                    {ing.aliasCount}
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
