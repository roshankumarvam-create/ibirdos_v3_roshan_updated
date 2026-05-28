// =====================================================================
// apps/web/src/app/[workspace]/loading.tsx
// =====================================================================
// Route-level Suspense fallback for every dashboard page. Next.js shows
// this instantly on navigation while the server component streams in,
// so the app never flashes a blank screen. Uses the design-system
// Skeleton primitive (no ad-hoc markup).
// =====================================================================
import { Skeleton } from "@/components/common/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-6" aria-busy="true" aria-live="polite">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-md border border-bg-border bg-bg-surface p-5"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Content block */}
      <div className="space-y-3 rounded-md border border-bg-border bg-bg-surface p-6">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
