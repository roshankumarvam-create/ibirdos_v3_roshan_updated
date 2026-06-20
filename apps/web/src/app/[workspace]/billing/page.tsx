import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardBody, Badge } from "@ibirdos/ui";
import { formatCents, formatDate } from "@/lib/format";
import { BillingActions } from "@/components/dashboard/billing-actions";
import { PlanCards } from "./plan-cards";

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
  priceCents: number | null;
  unitAmountMonthlyCents: number | null;
  seatsIncluded: number | null;
  comingSoon: boolean;
  features: readonly string[];
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const user = await requireSession();
  if (user.role !== "OWNER" && user.role !== "MANAGER") {
    return <div className="text-text-tertiary">Billing requires owner or manager access.</div>;
  }
  const c = await cookies();
  const sp = await searchParams;
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

      {sp.success === "1" && (
        <div className="rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm text-success font-medium">
          Payment successful — your subscription is now active.
        </div>
      )}

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
                <div className="mt-1">
                  <Badge tone={sub.status === "ACTIVE" ? "success" : sub.status === "TRIALING" ? "info" : "warning"}>
                    {sub.status.toLowerCase()}
                  </Badge>
                </div>
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
            <div className="text-sm text-text-secondary mb-6">No active subscription. Pick a plan below to get started.</div>
            <PlanCards
              plans={plans}
              userEmail={(user as any).email ?? ""}
              isOwner={user.role === "OWNER"}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
