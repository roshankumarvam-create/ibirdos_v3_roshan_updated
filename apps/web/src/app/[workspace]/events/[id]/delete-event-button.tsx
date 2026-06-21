"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
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
    if (res.error) {
      toast.error(res.error.message ?? "Failed to delete event. Please try again.");
      return;
    }
    toast.success("Event deleted successfully.");
    router.push(`/${workspaceSlug}/events` as Route);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={loading} className="text-danger hover:text-danger">
      {loading ? "Deleting…" : "Delete event"}
    </Button>
  );
}
