"use client";
// =====================================================================
// apps/web/src/app/[workspace]/error.tsx
// =====================================================================
// Error boundary for the dashboard segment. Next.js renders this when a
// server/client component throws during render. It isolates the failure
// to the page area (the sidebar/layout stay intact) and offers a retry
// that re-runs the failed render via reset().
// =====================================================================
import { useEffect } from "react";
import { Button } from "@ibirdos/ui";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console in dev; in prod this is captured by Sentry's
    // client SDK which hooks React error boundaries.
    console.error("[dashboard] render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
        <svg
          className="h-6 w-6 text-danger"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-text-primary">Something went wrong</h2>
        <p className="max-w-sm text-sm text-text-secondary">
          This section failed to load. You can retry, or head back to the dashboard.
        </p>
        {error.digest ? (
          <p className="pt-1 font-mono text-xs text-text-tertiary">ref: {error.digest}</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => window.location.assign("/")}>
          Go home
        </Button>
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
