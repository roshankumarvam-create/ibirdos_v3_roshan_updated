import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from "@ibirdos/ui";
import { formatCents, formatDate } from "@/lib/format";
import { BillingActions } from "@/components/dashboard/billing-actions";

interface Sub {
  plan: string;
  status: string;
  seatQuantity: number;
  unitAmountCents: number;
  currency: string;
  interval: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelAt: string | null;
  customer: { billingEmail: string };
}

interface Plan {
  plan: string;
  displayName: string;
  unitAmountMonthlyCents: number;
  unitAmountYearlyCents: number;
  seatIncluded: number;
  features: any;
}

export default async function BillingPage() {
  const user = await requireSession();
  if (user.role !== "OWNER" && user.role !== "MANAGER") {
    return <div className="text-text-tertiary">Billing requires owner or manager access.</div>;
  }
  const c = await cookies();
  const [subRes, plansRes] = await Promise.all([
    api.get<Sub>("/billing/subscription", { cookies: c }),
    api.get<{ items: Plan[] }>("/billing/plans", { cookies: c }),
  ]);
  const sub = subRes.data;
  const plans = plansRes.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">Subscription · payment history · plan management</p>
      </header>

      {sub ? (
        <Card>
          <CardHeader>
            <CardTitle>Current subscription</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-tertiary">Plan</div>
                <div className="mt-1 text-lg font-semibold">{sub.plan}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-tertiary">Status</div>
                <div className="mt-1"><Badge tone={sub.status === "ACTIVE" ? "success" : sub.status === "TRIALING" ? "info" : "warning"}>{sub.status.toLowerCase()}</Badge></div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-tertiary">Seats</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{sub.seatQuantity}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-tertiary">Per seat / {sub.interval}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{formatCents(sub.unitAmountCents)}</div>
              </div>
            </div>
            <div className="text-xs text-text-secondary border-t border-bg-border pt-3 flex items-center justify-between">
              <span>Period: {formatDate(sub.currentPeriodStart)} → {formatDate(sub.currentPeriodEnd)}</span>
              {sub.trialEndsAt && <span className="text-info">Trial ends {formatDate(sub.trialEndsAt)}</span>}
              {sub.cancelAt && <span className="text-warning">Cancels {formatDate(sub.cancelAt)}</span>}
            </div>
            {user.role === "OWNER" && <BillingActions />}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <div className="text-sm text-text-secondary mb-4">No active subscription. Pick a plan below to start.</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plans.filter(p => p.plan !== "ENTERPRISE").map((p) => (
                <div key={p.plan} className="rounded-md border border-bg-border bg-bg-elevated p-5 space-y-3">
                  <div className="font-semibold">{p.displayName}</div>
                  <div className="text-2xl font-semibold tabular-nums">{formatCents(p.unitAmountMonthlyCents)}<span className="text-xs text-text-tertiary"> / seat / mo</span></div>
                  <div className="text-xs text-text-secondary">{p.seatIncluded} seats included</div>
                  {user.role === "OWNER" && (
                    <form action={`/api/internal/billing/checkout`} method="POST">
                      <input type="hidden" name="plan" value={p.plan} />
                      <input type="hidden" name="interval" value="month" />
                      <Button type="submit" className="w-full">Choose plan</Button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
