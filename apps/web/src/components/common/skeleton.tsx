import { cn } from "@ibirdos/ui";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-bg-elevated", className)} />;
}

export function SkeletonCard() {
  return (
    <div className="rounded-md border border-bg-border bg-bg-surface p-6 space-y-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-full" />
    </div>
  );
}
