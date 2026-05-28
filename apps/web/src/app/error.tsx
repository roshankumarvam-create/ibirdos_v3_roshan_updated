"use client";
// =====================================================================
// apps/web/src/app/error.tsx — root segment error boundary
// =====================================================================
import { useEffect } from "react";
import { Button } from "@ibirdos/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[root] render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base p-6 text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-text-primary">Unexpected error</h1>
        <p className="max-w-sm text-sm text-text-secondary">
          We hit a snag loading the app. Retrying usually fixes it.
        </p>
      </div>
      <Button variant="primary" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
