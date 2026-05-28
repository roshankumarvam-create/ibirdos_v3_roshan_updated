// =====================================================================
// apps/web/src/app/page.tsx
// =====================================================================
// Landing. If the user is logged in, redirect to their workspace.
// Otherwise show a tiny holding page with sign-in / sign-up links.
// =====================================================================

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) {
    redirect(`/${user.workspaceSlug}`);
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="text-center max-w-lg">
        <h1 className="text-4xl font-semibold tracking-tight">IBirdOS</h1>
        <p className="mt-3 text-neutral-400">
          The AI operating system for commercial kitchens.
        </p>
        <div className="mt-8 flex gap-3 justify-center">
          <Link
            href="/login"
            className="rounded-md border border-neutral-800 px-4 py-2 text-sm hover:border-neutral-700 transition"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium px-4 py-2 text-sm transition"
          >
            Create workspace
          </Link>
        </div>
      </div>
    </main>
  );
}
