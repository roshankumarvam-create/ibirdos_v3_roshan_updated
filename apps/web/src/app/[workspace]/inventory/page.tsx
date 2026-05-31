"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Card, Badge, Button, EmptyState } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { formatCents, formatStock, formatCostPerUnit, relativeTime } from "@/lib/format";

interface Alert {
  id: string;
  status: string;
  currentCanonical: string;
  thresholdCanonical: string;
  detectedAt: string;
  ingredient: { id: string; name: string; canonicalUnit: string; preferredDisplayUnit: string | null };
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
  ingredient: { id: string; name: string; canonicalUnit: string; preferredDisplayUnit: string | null };
}

interface IngredientStock {
  id: string;
  name: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  currentStockCanonical: number;
  currentCostCents: number | null;
  reorderThresholdCanonical: number | null;
  lastPriceChangeAt: string | null;
}

type Tab = "stock" | "history";

export default function InventoryPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const [tab, setTab] = useState<Tab>("stock");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [ingredients, setIngredients] = useState<IngredientStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [reversing, setReversing] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ items: Alert[] }>("/inventory/alerts/low-stock?status=OPEN"),
      api.get<{ items: Tx[] }>("/inventory/transactions?limit=50"),
      api.get<{ items: IngredientStock[] }>("/ingredients?limit=100"),
    ]).then(([alertsRes, txRes, ingRes]) => {
      if (ingRes.error) console.error("[inventory] ingredients fetch failed:", ingRes.error);
      setAlerts(alertsRes.data?.items ?? []);
      setTxs(txRes.data?.items ?? []);
      setIngredients(ingRes.data?.items ?? []);
      setLoading(false);
    });
  }, []);

  async function handleReverse(txId: string) {
    setReversing(txId);
    const res = await api.post(`/inventory/transactions/${txId}/reverse`);
    setReversing(null);
    if (!res.error) {
      // Refresh transactions
      const fresh = await api.get<{ items: Tx[] }>("/inventory/transactions?limit=50");
      if (fresh.data) setTxs(fresh.data.items);
      const ingFresh = await api.get<{ items: IngredientStock[] }>("/ingredients?limit=100");
      if (ingFresh.data) setIngredients(ingFresh.data.items);
    }
  }

  if (loading) return <div className="text-text-secondary py-8">Loading…</div>;

  const stockSorted = [...ingredients].sort((a, b) => a.name.localeCompare(b.name));
  const lowCount = stockSorted.filter(
    (i) => i.currentStockCanonical > 0 && i.reorderThresholdCanonical != null && i.currentStockCanonical < i.reorderThresholdCanonical,
  ).length;
  const outCount = stockSorted.filter((i) => i.currentStockCanonical <= 0).length;
  const alertCount = lowCount + outCount;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inventory</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            Append-only ledger ·{" "}
            {alertCount > 0
              ? `${alertCount} item${alertCount === 1 ? "" : "s"} need attention`
              : "all stock levels OK"}
          </p>
        </div>
        <Link href={`/${workspace}/inventory/adjust` as any}>
          <Button>+ Manual adjustment</Button>
        </Link>
      </header>

      {/* Low-stock alerts */}
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
                <th className="text-right px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {alerts.map((a) => (
                <tr key={a.id} className="hover:bg-bg-hover/30">
                  <td className="px-5 py-3">
                    <Link href={`/${workspace}/ingredients/${a.ingredient.id}` as any} className="text-text-primary hover:text-accent-500">
                      {a.ingredient.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-warning">
                    {formatStock(Number(a.currentCanonical), a.ingredient.canonicalUnit, a.ingredient.preferredDisplayUnit)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">
                    {formatStock(Number(a.thresholdCanonical), a.ingredient.canonicalUnit, a.ingredient.preferredDisplayUnit)}
                  </td>
                  <td className="px-5 py-3 text-text-tertiary text-xs">{relativeTime(a.detectedAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/${workspace}/inventory/adjust?ingredientId=${a.ingredient.id}` as any} className="text-xs text-accent-500 hover:text-accent-400">
                      Adjust
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Tab selector */}
      <div className="flex gap-1 bg-bg-inset border border-bg-border rounded-lg p-1 w-fit">
        {(["stock", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded text-sm transition-colors ${
              tab === t
                ? "bg-bg-card text-text-primary shadow-sm"
                : "text-text-tertiary hover:text-text-secondary"
            }`}
          >
            {t === "stock" ? "Current stock" : "Transaction history"}
          </button>
        ))}
      </div>

      {/* Current stock tab */}
      {tab === "stock" && (
        <Card>
          {stockSorted.length === 0 ? (
            <EmptyState title="No ingredients yet" description="Add ingredients or confirm an invoice to start tracking stock." />
          ) : (
            <>
              <div className="px-5 py-3 border-b border-bg-border text-xs font-mono text-text-tertiary">
                {stockSorted.length} item{stockSorted.length === 1 ? "" : "s"}
                {lowCount > 0 && ` · ${lowCount} low`}
                {outCount > 0 && ` · ${outCount} out`}
              </div>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Ingredient</th>
                  <th className="text-right px-5 py-3 font-medium">Stock</th>
                  <th className="text-right px-5 py-3 font-medium">Unit cost</th>
                  <th className="text-right px-5 py-3 font-medium">Reorder at</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-right px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {stockSorted.map((ing) => {
                  const isLow = ing.currentStockCanonical > 0 &&
                    ing.reorderThresholdCanonical != null &&
                    ing.currentStockCanonical < ing.reorderThresholdCanonical;
                  const isOut = ing.currentStockCanonical <= 0;
                  return (
                    <tr key={ing.id} className="hover:bg-bg-hover/30">
                      <td className="px-5 py-3">
                        <Link href={`/${workspace}/ingredients/${ing.id}` as any} className="text-text-primary hover:text-accent-500 transition-colors">
                          {ing.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums font-medium">
                        {formatStock(ing.currentStockCanonical, ing.canonicalUnit, ing.preferredDisplayUnit)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-text-secondary">
                        {ing.currentCostCents != null
                          ? formatCostPerUnit(ing.currentCostCents, ing.canonicalUnit, ing.preferredDisplayUnit)
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-text-tertiary text-xs">
                        {ing.reorderThresholdCanonical != null
                          ? formatStock(ing.reorderThresholdCanonical, ing.canonicalUnit, ing.preferredDisplayUnit)
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        {isOut ? (
                          <Badge tone="danger">Out</Badge>
                        ) : isLow ? (
                          <Badge tone="warning">Low</Badge>
                        ) : (
                          <Badge tone="success">OK</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link href={`/${workspace}/inventory/adjust?ingredientId=${ing.id}` as any} className="text-xs text-accent-500 hover:text-accent-400">
                          Adjust
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </>
          )}
        </Card>
      )}

      {/* Transaction history tab */}
      {tab === "history" && (
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
                  <th className="text-right px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {txs.map((tx) => {
                  const isPositive = tx.quantityCanonical > 0;
                  const absQty = Math.abs(tx.quantityCanonical);
                  const preferred = formatStock(absQty, tx.ingredient.canonicalUnit, tx.ingredient.preferredDisplayUnit);
                  const totalCostCents = tx.costMicrocents ? Math.round(Number(tx.costMicrocents) / 1000) : null;

                  return (
                    <tr key={tx.id} className="hover:bg-bg-hover/30">
                      <td className="px-5 py-3 text-text-tertiary text-xs">{relativeTime(tx.createdAt)}</td>
                      <td className="px-5 py-3">
                        <Link href={`/${workspace}/ingredients/${tx.ingredient.id}` as any} className="text-text-primary hover:text-accent-500">
                          {tx.ingredient.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-xs">
                        <Badge tone={tx.kind === "RECEIVE" ? "success" : tx.kind === "WASTE" ? "danger" : "neutral"}>
                          {tx.kind.toLowerCase()}
                        </Badge>
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums ${isPositive ? "text-success" : "text-danger"}`}>
                        {isPositive ? "+" : "−"}{preferred}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-text-secondary">
                        {formatStock(tx.balanceAfterCanonical, tx.ingredient.canonicalUnit, tx.ingredient.preferredDisplayUnit)}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-text-secondary">
                        {formatCents(totalCostCents)}
                      </td>
                      <td className="px-5 py-3 text-text-tertiary text-xs font-mono">
                        {tx.sourceRef ?? tx.sourceKind}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          disabled={reversing === tx.id}
                          onClick={() => handleReverse(tx.id)}
                          className="text-[10px] text-text-tertiary hover:text-warning uppercase tracking-wider disabled:opacity-40"
                          title="Reverse this transaction"
                        >
                          {reversing === tx.id ? "…" : "Reverse"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
