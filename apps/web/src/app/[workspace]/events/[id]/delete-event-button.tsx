"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

interface Props {
  eventId: string;
  workspaceSlug: string;
  eventName: string;
}

export function DeleteEventButton({ eventId, workspaceSlug, eventName }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    if (!confirm(`Delete "${eventName}"? This cannot be undone.`)) return;
    setLoading(true);
    const res = await api.delete(`/events/${eventId}`);
    setLoading(false);
    if (res.error) { alert(res.error.message ?? "Delete failed"); return; }
    router.push(`/${workspaceSlug}/events` as Route);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={loading} className="text-danger hover:text-danger">
      {loading ? "Deleting…" : "Delete event"}
    </Button>
  );
}
