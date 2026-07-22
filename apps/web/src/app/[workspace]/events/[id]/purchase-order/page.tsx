import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { formatCents, formatDateTime } from "@/lib/format";
import { PrintButton } from "./print-button";

interface PurchaseOrderLine {
  ingredientId: string;
  ingredientName: string;
  quantityDisplay: string;
  unitPriceCents: number | null;
  unitLabel: string;
  lineTotalCents: number | null;
}

interface PurchaseOrderVendorGroup {
  vendorId: string | null;
  vendorName: string;
  vendorContactEmail: string | null;
  lines: PurchaseOrderLine[];
  subtotalCents: number;
}

interface PurchaseOrderPreview {
  workspaceName: string;
  eventName: string;
  generatedAt: string;
  vendorGroups: PurchaseOrderVendorGroup[];
  noVendorGroup: PurchaseOrderVendorGroup | null;
  grandTotalCents: number;
}

function VendorSection({ group }: { group: PurchaseOrderVendorGroup }) {
  return (
    <div className="mb-8 break-inside-avoid">
      <div className="flex items-baseline justify-between border-b-2 border-neutral-800 pb-1 mb-2">
        <h2 className="text-base font-semibold">{group.vendorName}</h2>
        {group.vendorContactEmail && <span className="text-xs text-neutral-500">{group.vendorContactEmail}</span>}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-1 font-medium">Ingredient</th>
            <th className="py-1 font-medium text-right">Quantity</th>
            <th className="py-1 font-medium text-right">Unit price</th>
            <th className="py-1 font-medium text-right">Line total</th>
          </tr>
        </thead>
        <tbody>
          {group.lines.map((line) => (
            <tr key={line.ingredientId} className="border-t border-neutral-200">
              <td className="py-1.5">{line.ingredientName}</td>
              <td className="py-1.5 text-right tabular-nums">{line.quantityDisplay}</td>
              <td className="py-1.5 text-right tabular-nums">
                {line.unitPriceCents != null ? `${formatCents(line.unitPriceCents)}/${line.unitLabel}` : "—"}
              </td>
              <td className="py-1.5 text-right tabular-nums font-medium">
                {line.lineTotalCents != null ? formatCents(line.lineTotalCents) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-800">
            <td colSpan={3} className="py-1.5 text-right text-xs uppercase tracking-wide text-neutral-500">Subtotal</td>
            <td className="py-1.5 text-right font-semibold tabular-nums">{formatCents(group.subtotalCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { id } = await params;
  const user = await requireSession();
  const c = await cookies();

  const res = await api.get<PurchaseOrderPreview>(`/events/${id}/purchase-order`, { cookies: c });
  if (res.error || !res.data) notFound();
  const po = res.data;

  const hasNothingOutstanding = po.vendorGroups.length === 0 && !po.noVendorGroup;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link href={`../` as any} className="text-xs text-accent-400 hover:underline">
          ← Back to event
        </Link>
        {!hasNothingOutstanding && <PrintButton />}
      </div>

      <div className="bg-white text-neutral-900 rounded-lg border border-neutral-200 p-8 print:border-0 print:rounded-none print:p-0">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold">Purchase Order</h1>
            <p className="text-sm text-neutral-600">{po.workspaceName}</p>
          </div>
          <div className="text-right text-xs text-neutral-500">
            <div>For event: <span className="text-neutral-800">{po.eventName}</span></div>
            <div>Generated: {formatDateTime(po.generatedAt, user.workspaceTimeZone)}</div>
          </div>
        </div>

        {hasNothingOutstanding ? (
          <p className="text-sm text-neutral-500 italic">Nothing outstanding for this event right now.</p>
        ) : (
          <>
            {po.vendorGroups.map((group) => (
              <VendorSection key={group.vendorId ?? "none"} group={group} />
            ))}

            {po.noVendorGroup && (
              <div className="mb-8 break-inside-avoid rounded border border-amber-300 bg-amber-50 p-4 print:border print:bg-white">
                <p className="text-xs font-medium text-amber-800 mb-2">
                  ⚠ No vendor assigned — cannot be ordered until a vendor is set on these ingredients
                </p>
                <VendorSection group={po.noVendorGroup} />
              </div>
            )}

            <div className="flex justify-between items-center border-t-2 border-neutral-800 pt-3 mt-2">
              <span className="text-sm font-semibold uppercase tracking-wide">Grand total</span>
              <span className="text-lg font-bold tabular-nums">{formatCents(po.grandTotalCents)}</span>
            </div>
          </>
        )}
      </div>

      <p className="text-[10px] text-text-tertiary text-center mt-4 print:hidden">
        This is a document preview, not a sent order — nothing has been emailed to any vendor.
      </p>
    </div>
  );
}
