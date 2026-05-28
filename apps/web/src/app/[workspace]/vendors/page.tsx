import Link from "next/link";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, Badge, Button, EmptyState } from "@ibirdos/ui";

interface Vendor {
  id: string;
  name: string;
  code: string | null;
  contactEmail: string | null;
  integrationType: "NONE" | "API" | "EDI" | "EMAIL" | "CSV";
  _count?: { ingredients: number };
}

export default async function VendorsPage() {
  const user = await requireSession();
  const c = await cookies();
  const res = await api.get<{ items: Vendor[] }>("/vendors", { cookies: c });
  const items = res.data?.items ?? [];
  const canCreate = user.role === "OWNER" || user.role === "MANAGER";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vendors</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">{items.length} vendor{items.length === 1 ? "" : "s"} · catalog imports + price sync</p>
        </div>
        {canCreate && <Link href={`/${user.workspaceSlug}/vendors/new` as any}><Button>+ Add vendor</Button></Link>}
      </header>

      <Card>
        {items.length === 0 ? (
          <EmptyState title="No vendors yet" description="Add a vendor to import their catalog and link to ingredients." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Vendor</th>
                <th className="text-left px-5 py-3 font-medium">Account code</th>
                <th className="text-left px-5 py-3 font-medium">Contact</th>
                <th className="text-left px-5 py-3 font-medium">Integration</th>
                <th className="text-right px-5 py-3 font-medium">Ingredients</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {items.map((v) => (
                <tr key={v.id} className="hover:bg-bg-hover/30">
                  <td className="px-5 py-3 text-text-primary">{v.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-text-secondary">{v.code ?? "—"}</td>
                  <td className="px-5 py-3 text-text-secondary text-xs">{v.contactEmail ?? "—"}</td>
                  <td className="px-5 py-3">
                    <Badge tone={v.integrationType === "API" ? "success" : v.integrationType === "NONE" ? "neutral" : "info"}>
                      {v.integrationType.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-tertiary">{v._count?.ingredients ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
