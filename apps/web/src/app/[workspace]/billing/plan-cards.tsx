"use client";

import { useState } from "react";
import { Button } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { formatCents } from "@/lib/format";
import { toast } from "@/lib/toast";

interface Plan {
  plan: string;
  displayName: string;
  priceCents: number | null;
  unitAmountMonthlyCents: number | null;
  seatsIncluded: number | null;
  comingSoon: boolean;
  features: readonly string[];
}

interface Props {
  plans: Plan[];
  userEmail: string;
  isOwner: boolean;
}

export function PlanCards({ plans, userEmail, isOwner }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  async function handleChoosePlan(plan: string) {
    if (!userEmail || !userEmail.includes("@")) {
      toast.error("Add your email address in account settings before subscribing.");
      return;
    }
    setLoading(plan);
    const successUrl = window.location.origin + window.location.pathname + "?success=1";
    const cancelUrl = window.location.origin + window.location.pathname;
    const res = await api.post<{ checkoutUrl: string }>("/billing/checkout", {
      plan,
      interval: "month",
      billingEmail: userEmail,
      successUrl,
      cancelUrl,
    });
    setLoading(null);

    if (res.data?.checkoutUrl) {
      window.location.href = res.data.checkoutUrl;
      return;
    }

    const status = (res.error as any)?.status ?? 0;
    if (status === 503 || res.error?.code === "billing_not_configured") {
      toast.error("Billing is in development. Contact admin to activate.");
    } else {
      toast.error(res.error?.message ?? "Failed to start checkout. Please try again.");
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {plans.map((p) => (
        <div
          key={p.plan}
          className={`rounded-md border p-5 space-y-3 ${
            p.comingSoon
              ? "border-bg-border bg-bg-inset opacity-70"
              : "border-bg-border bg-bg-elevated"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold">{p.displayName}</div>
            {p.comingSoon && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-bg-border text-text-tertiary font-medium">
                Coming soon
              </span>
            )}
          </div>
          {p.priceCents != null ? (
            <div className="text-2xl font-semibold tabular-nums">
              {formatCents(p.priceCents)}
              <span className="text-xs text-text-tertiary"> / month</span>
            </div>
          ) : (
            <div className="text-2xl font-semibold text-text-secondary">Contact us</div>
          )}
          {p.seatsIncluded != null && (
            <div className="text-xs text-text-secondary">{p.seatsIncluded} seat{p.seatsIncluded !== 1 ? "s" : ""} included</div>
          )}
          <ul className="space-y-1">
            {p.features.map((f) => (
              <li key={f} className="text-xs text-text-secondary flex gap-1.5">
                <span className="text-success mt-px">✓</span>
                {f}
              </li>
            ))}
          </ul>
          {isOwner && (
            p.comingSoon ? (
              <a
                href="mailto:sales@ibirdos.com"
                className="block w-full text-center text-sm py-2 px-4 rounded border border-bg-border text-text-secondary hover:text-text-primary hover:border-accent-500 transition-colors"
              >
                Contact us
              </a>
            ) : (
              <Button
                className="w-full"
                onClick={() => handleChoosePlan(p.plan)}
                disabled={loading === p.plan}
              >
                {loading === p.plan ? "Redirecting…" : "Choose plan"}
              </Button>
            )
          )}
        </div>
      ))}
    </div>
  );
}
