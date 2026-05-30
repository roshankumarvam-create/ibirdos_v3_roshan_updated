"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@ibirdos/ui";
import { toast } from "@/lib/toast";

export function BillingActions() {
  const [loading, setLoading] = useState(false);

  async function openPortal() {
    setLoading(true);
    const res = await api.post<{ portalUrl: string }>("/billing/portal", { returnUrl: window.location.href });
    setLoading(false);
    if (res.data?.portalUrl) window.location.href = res.data.portalUrl;
    else toast.error(res.error?.message ?? "Failed to open portal");
  }

  return (
    <div className="pt-2">
      <Button onClick={openPortal} loading={loading}>Manage subscription</Button>
    </div>
  );
}
