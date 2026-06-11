"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle, Button, Badge } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

interface TenderEntry {
  id: string;
  tenderType: string;
  amount: string | number;
  count: number;
}

interface DailySalesRecord {
  id: string;
  saleDate: string;
  grossSales: string | number;
  netSales: string | number;
  tax: string | number;
  discounts: string | number;
  voids: string | number;
  refunds: string | number;
  cateringSales: string | number;
  onlineSales: string | number;
  deliveryAppSales: string | number;
  notes: string | null;
  enteredBy: { displayName: string | null; username: string };
  enteredAt: string;
  tenders: TenderEntry[];
  variance: {
    netSales: number;
    tenderTotal: number;
    variance: number;
    balanced: boolean;
  };
}

function fmt(v: string | number) {
  return `$${parseFloat(String(v)).toFixed(2)}`;
}

export default function DailySalesDetailPage() {
  const params = useParams<{ workspace: string; id: string }>();
  const router = useRouter();
  const ws = params.workspace;

  const [record, setRecord] = useState<DailySalesRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.get<DailySalesRecord>(`/daily-sales/${params.id}`).then((res) => {
      if (res.data) setRecord(res.data);
      setLoading(false);
    });
  }, [params.id]);

  async function handleDelete() {
    if (!confirm("Delete this daily sales entry? This cannot be undone.")) return;
    setDeleting(true);
    await api.delete(`/daily-sales/${params.id}`);
    router.push(`/${ws}/daily-sales` as Route);
  }

  if (loading) return <div className="p-8 text-sm text-text-tertiary">Loading…</div>;
  if (!record) return <div className="p-8 text-sm text-danger">Record not found.</div>;

  const saleDate = new Date(record.saleDate).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="space-y-6 pb-20 max-w-2xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${ws}/daily-sales` as Route)}>
            ← Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{saleDate}</h1>
            <p className="text-xs text-text-tertiary">
              Entered by {record.enteredBy.displayName ?? record.enteredBy.username} ·{" "}
              {new Date(record.enteredAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            loading={deleting}
            className="text-danger hover:text-danger"
          >
            Delete
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push(`/${ws}/daily-sales/${params.id}/edit` as Route)}
          >
            Edit
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader><CardTitle>Sales breakdown</CardTitle></CardHeader>
        <CardBody>
          <dl className="divide-y divide-bg-border text-sm">
            {[
              ["Gross sales", fmt(record.grossSales)],
              ["Net sales", fmt(record.netSales)],
              ["Tax", fmt(record.tax)],
              ["Discounts", fmt(record.discounts)],
              ["Voids", fmt(record.voids)],
              ["Refunds", fmt(record.refunds)],
              ["Catering sales", fmt(record.cateringSales)],
              ["Online sales", fmt(record.onlineSales)],
              ["Delivery app sales", fmt(record.deliveryAppSales)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2">
                <dt className="text-text-secondary">{label}</dt>
                <dd className="font-medium text-text-primary">{value}</dd>
              </div>
            ))}
          </dl>
          {record.notes && (
            <p className="mt-4 text-sm text-text-secondary border-t border-bg-border pt-4">{record.notes}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tender reconciliation</CardTitle></CardHeader>
        <CardBody>
          {record.tenders.length === 0 ? (
            <p className="text-sm text-text-tertiary">No tender entries recorded.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                  <th className="text-left pb-2">Type</th>
                  <th className="text-right pb-2">Count</th>
                  <th className="text-right pb-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {record.tenders.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 text-text-primary">{t.tenderType.replace(/_/g, " ")}</td>
                    <td className="py-2 text-right text-text-secondary">{t.count}</td>
                    <td className="py-2 text-right font-medium">{fmt(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-bg-border font-semibold">
                  <td className="pt-2 text-text-primary">Total</td>
                  <td />
                  <td className="pt-2 text-right">{fmt(record.variance.tenderTotal)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          <div className={`mt-4 rounded-md px-4 py-3 text-sm flex items-center justify-between ${record.variance.balanced ? "bg-success/10 border border-success/30 text-success" : "bg-warning/10 border border-warning/30 text-warning"}`}>
            <span>Net sales: <strong>{fmt(record.variance.netSales)}</strong> · Tender total: <strong>{fmt(record.variance.tenderTotal)}</strong></span>
            <Badge tone={record.variance.balanced ? "success" : "warning"}>
              {record.variance.balanced
                ? "Balanced"
                : `${record.variance.variance >= 0 ? "+" : ""}${record.variance.variance.toFixed(2)}`}
            </Badge>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
