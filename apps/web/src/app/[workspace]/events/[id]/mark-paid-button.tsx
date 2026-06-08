"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ibirdos/ui";
import { api } from "@/lib/api";

interface Props {
  eventId: string;
}

export function MarkPaidButton({ eventId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleClick = async () => {
    if (!confirm("Mark this event as PAID? This will freeze costs, generate kitchen tasks, and check inventory.")) return;
    setLoading(true);
    setError(null);
    const res = await api.post(`/events/${eventId}/paid`, {});
    setLoading(false);
    if (res.error) { setError(res.error.message); return; }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <Button variant="primary" size="sm" onClick={handleClick} disabled={loading}>
        {loading ? "Processing…" : "Mark as Paid"}
      </Button>
      {error && <div className="text-xs text-danger">{error}</div>}
    </div>
  );
}
