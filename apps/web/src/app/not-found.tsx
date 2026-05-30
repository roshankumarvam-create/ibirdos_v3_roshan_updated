// =====================================================================
// apps/web/src/app/not-found.tsx — global 404
// =====================================================================
import Link from "next/link";
import { Button } from "@ibirdos/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-bg-base p-6 text-center">
      <p className="font-mono text-5xl font-bold text-accent-500">404</p>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-text-primary">Page not found</h1>
        <p className="max-w-sm text-sm text-text-secondary">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
      </div>
      <Link href="/">
        <Button variant="primary">Back to dashboard</Button>
      </Link>
    </div>
  );
}
