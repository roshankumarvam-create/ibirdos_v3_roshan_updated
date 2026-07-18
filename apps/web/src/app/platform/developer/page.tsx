import { cookies } from "next/headers";

import { api } from "@/lib/api";
import { requirePlatformRole } from "@/lib/platform-session";
import { PlatformAnalyticsCards, type PlatformAnalytics } from "../PlatformAnalyticsCards";
import { PlatformChangePasswordForm } from "../PlatformChangePasswordForm";
import { PlatformLogoutButton } from "../PlatformLogoutButton";

export default async function DeveloperPortalPage() {
  await requirePlatformRole("DEVELOPER");

  const c = await cookies();
  const res = await api.get<PlatformAnalytics>("/platform/developer/analytics", { cookies: c });

  return (
    <div className="min-h-screen bg-bg-base">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">Developer portal</h1>
            <p className="mt-1 text-xs text-text-tertiary">Platform-wide analytics</p>
          </div>
          <PlatformLogoutButton />
        </header>

        {res.data ? (
          <PlatformAnalyticsCards data={res.data} />
        ) : (
          <p className="text-sm text-text-secondary">Analytics unavailable. Check API connection.</p>
        )}

        <div className="pt-2 border-t border-bg-border">
          <p className="pt-4 text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Account</p>
          <PlatformChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
