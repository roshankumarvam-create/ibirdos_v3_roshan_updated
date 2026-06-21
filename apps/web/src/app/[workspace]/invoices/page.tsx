import Link from "next/link";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, Badge, Button, EmptyState } from "@ibirdos/ui";
import { StatusBadge } from "@/components/common/status-badge";
import { formatCents, formatDate, relativeTime } from "@/lib/format";

interface InvoiceListItem {
  id: string;
  status: "UPLOADING" | "EXTRACTING" | "EXTRACTION_FAILED" | "PENDING_REVIEW" | "CONFIRMED" | "ARCHIVED";
  vendorNameRaw: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalCents: number | null;
  createdAt: string;
  vendor: { id: string; name: string } | null;
  _count: { lines: number };
}

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  UPLOADING: "info",
  EXTRACTING: "info",
  EXTRACTION_FAILED: "danger",
  PENDING_REVIEW: "warning",
  CONFIRMED: "success",
  ARCHIVED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  UPLOADING: "uploading",
  EXTRACTING: "extracting…",
  EXTRACTION_FAILED: "failed",
  PENDING_REVIEW: "draft",
  CONFIRMED: "✓ confirmed",
  ARCHIVED: "archived",
};

export default async function InvoicesPage() {
  const user = await requireSession();
  const c = await cookies();
  const res = await api.get<{ items: InvoiceListItem[]; nextCursor: string | null }>(
    "/invoices?limit=50",
    { cookies: c },
  );
  const items = res.data?.items ?? [];
  const canUpload = user.role === "OWNER" || user.role === "MANAGER";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {items.length} invoice{items.length === 1 ? "" : "s"} · confirm to update prices + inventory
          </p>
        </div>
        {canUpload && (
          <Link href={`/${user.workspaceSlug}/invoices/new` as any}>
            <Button>+ Upload invoice</Button>
          </Link>
        )}
      </header>

      <Card>
        {items.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="Upload a vendor invoice PDF to auto-extract line items and update ingredient prices."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Invoice #</th>
                <th className="text-left px-5 py-3 font-medium">Vendor</th>
                <th className="text-left px-5 py-3 font-medium">Date</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-right px-5 py-3 font-medium">Total</th>
                <th className="text-right px-5 py-3 font-medium">Lines</th>
                <th className="text-left px-5 py-3 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {items.map((inv) => (
                <tr key={inv.id} className="hover:bg-bg-hover/30 transition-colors">
                  <td className="px-5 py-3">
                    <Link
                      href={`/${user.workspaceSlug}/invoices/${inv.id}` as any}
                      className="text-text-primary hover:text-accent-500 font-mono text-xs"
                    >
                      {inv.invoiceNumber ?? `#${inv.id.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-text-secondary">
                    {inv.vendor?.name ?? inv.vendorNameRaw ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-text-secondary text-xs">
                    {inv.invoiceDate ? formatDate(inv.invoiceDate) : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge
                      label={STATUS_LABEL[inv.status] ?? inv.status.toLowerCase().replace(/_/g, " ")}
                      tone={STATUS_TONE[inv.status] ?? "neutral"}
                    />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatCents(inv.totalCents)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">
                    {inv._count.lines}
                  </td>
                  <td className="px-5 py-3 text-text-tertiary text-xs">
                    {relativeTime(inv.createdAt)}
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
