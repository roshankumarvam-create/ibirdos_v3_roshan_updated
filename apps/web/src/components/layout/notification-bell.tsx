"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWorkspaceChannel } from "@/hooks/use-workspace-channel";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell({ workspaceSlug }: { workspaceSlug: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: async () => {
      const res = await api.get<{ items: Notification[]; unreadCount: number }>("/notifications?unreadOnly=true&limit=10");
      return res.data;
    },
    refetchInterval: 30_000,
  });

  // Realtime: a published notification triggers a refetch + toast
  useWorkspaceChannel<{ title: string; kind: string }>(
    `workspace:notifications`, // generic listener; the gateway maps server channel correctly
    (msg) => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.info(msg.title);
    },
  );

  const count = data?.unreadCount ?? 0;
  return (
    <Link href={`/${workspaceSlug}/insights` as any} className="relative inline-flex items-center px-3 py-1.5 rounded text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover">
      <span>Notifications</span>
      {count > 0 && (
        <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-accent-500 text-bg-base text-[10px] font-medium">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
