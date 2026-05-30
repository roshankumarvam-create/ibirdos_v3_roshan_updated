import Link from "next/link";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, Badge, Button, EmptyState } from "@ibirdos/ui";
import { formatCents, formatNumber, relativeTime } from "@/lib/format";

interface Alert {
  id: string;
  status: string;
  currentCanonical: string;
  thresholdCanonical: string;
  detectedAt: string;
  ingredient: { id: string; name: string; canonicalUnit: string };
}

interface Tx {
  id: string;
  ingredientId: string;
  kind: string;
  quantityCanonical: number;
  balanceAfterCanonical: number;
  costMicrocents: string | null;
  sourceKind: string;
  sourceRef: string | null;
  createdAt: string;
  ingredient: { id: string; name: string; canonicalUnit: string };
}

export default async function InventoryPage() {
  const user = await requireSession();
  const c = await cookies();
  const [alertsRes, txRes] = await Promise.all([
    api.get<{ items: Alert[] }>("/inventory/alerts/low-stock?status=OPEN", { cookies: c }),
    api.get<{ items: Tx[] }>("/inventory/transactions?limit=50", { cookies: c }),
  ]);
  const alerts = alertsRes.data?.items ?? [];
  const txs = txRes.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Inventory</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">
          Append-only ledger · {alerts.length} open alert{alerts.length === 1 ? "" : "s"}
        </p>
      </header>

      {alerts.length > 0 && (
        <Card>
          <div className="px-5 py-3 border-b border-bg-border">
            <h2 className="font-medium text-warning">Low stock alerts</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Ingredient</th>
                <th className="text-right px-5 py-3 font-medium">Current</th>
                <th className="text-right px-5 py-3 font-medium">Threshold</th>
                <th className="text-left px-5 py-3 font-medium">Detected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {alerts.map((a) => (
                <tr key={a.id} className="hover:bg-bg-hover/30">
                  <td className="px-5 py-3">
                    <Link href={`/${user.workspaceSlug}/ingredients/${a.ingredient.id}` as any} className="text-text-primary hover:text-accent-500">
                      {a.ingredient.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-warning">{Number(a.currentCanonical).toFixed(1)} {a.ingredient.canonicalUnit}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{Number(a.thresholdCanonical).toFixed(0)} {a.ingredient.canonicalUnit}</td>
                  <td className="px-5 py-3 text-text-tertiary text-xs">{relativeTime(a.detectedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <div className="px-5 py-3 border-b border-bg-border flex items-center justify-between">
          <h2 className="font-medium">Recent transactions</h2>
          <span className="text-xs text-text-tertiary">Last {txs.length}</span>
        </div>
        {txs.length === 0 ? (
          <EmptyState title="No inventory movements yet" description="Stock is updated when invoices are confirmed and recipes consumed." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">When</th>
                <th className="text-left px-5 py-3 font-medium">Ingredient</th>
                <th className="text-left px-5 py-3 font-medium">Kind</th>
                <th className="text-right px-5 py-3 font-medium">Δ Qty</th>
                <th className="text-right px-5 py-3 font-medium">Balance</th>
                <th className="text-right px-5 py-3 font-medium">Cost</th>
                <th className="text-left px-5 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {txs.map((tx) => {
                const isPositive = tx.quantityCanonical > 0;
                return (
                  <tr key={tx.id} className="hover:bg-bg-hover/30">
                    <td className="px-5 py-3 text-text-tertiary text-xs">{relativeTime(tx.createdAt)}</td>
                    <td className="px-5 py-3">
                      <Link href={`/${user.workspaceSlug}/ingredients/${tx.ingredient.id}` as any} className="text-text-primary hover:text-accent-500">
                        {tx.ingredient.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <Badge tone={tx.kind === "RECEIVE" ? "success" : tx.kind === "WASTE" ? "danger" : "neutral"}>
                        {tx.kind.toLowerCase()}
                      </Badge>
                    </td>
                    <td className={`px-5 py-3 text-right tabular-nums ${isPositive ? "text-success" : "text-danger"}`}>
                      {isPositive ? "+" : ""}{tx.quantityCanonical.toFixed(1)} {tx.ingredient.canonicalUnit}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{tx.balanceAfterCanonical.toFixed(1)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-secondary">
                      {tx.costMicrocents ? formatCents(Math.round(Number(tx.costMicrocents) / 1000)) : "—"}
                    </td>
                    <td className="px-5 py-3 text-text-tertiary text-xs">{tx.sourceKind}</td>
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
