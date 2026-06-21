"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody } from "@ibirdos/ui";

interface Alert {
  id: string;
  ingredient: {
    id: string; name: string; canonicalUnit: string;
    purchaseUnit: string | null; reorderQty: number | null;
  };
  currentCanonical: string;
  thresholdCanonical: string;
}

export function LowStockBanner({ workspaceSlug }: { workspaceSlug: string }) {
  const { data } = useQuery({
    queryKey: ["low-stock"],
    queryFn: async () => {
      const res = await api.get<{ items: Alert[] }>("/inventory/alerts/low-stock?status=OPEN");
      return res.data;
    },
    refetchInterval: 30_000,
  });

  if (!data?.items?.length) return null;

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardBody className="flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-warning font-medium">{data.items.length} ingredient{data.items.length === 1 ? "" : "s"} below reorder threshold</span>
          <span className="text-text-secondary ml-2">
            {data.items.slice(0, 3).map((a) => a.ingredient.name).join(", ")}
            {data.items.length > 3 && ` +${data.items.length - 3} more`}
          </span>
        </div>
        <Link href={`/${workspaceSlug}/inventory`} className="text-sm text-warning hover:text-warning/80 underline">
          View →
        </Link>
      </CardBody>
    </Card>
  );
}
