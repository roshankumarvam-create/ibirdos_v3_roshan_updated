// =====================================================================
// apps/web/src/lib/platform-session.ts
// =====================================================================
// Server-side platform session helpers, mirroring lib/session.ts's
// pattern -- but requirePlatformRole() calls notFound() rather than
// redirect(), so a wrong-role or non-platform visitor gets a genuine
// server-rendered 404, not a client-visible bounce that reveals the
// route exists. Reuses the shared `api` client -- it just forwards
// whatever cookies are present; the API's PlatformAuthGuard is the one
// that knows to look for ibirdos.platform_session specifically.
// =====================================================================

import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";

import { api } from "./api";

export interface PlatformSessionUser {
  platformUserId: string;
  role: "ADMIN" | "DEVELOPER";
}

export const getPlatformSession = cache(async (): Promise<PlatformSessionUser | null> => {
  const c = await cookies();
  const res = await api.get<PlatformSessionUser>("/platform/me", {
    cookies: c,
    noAuthRedirect: true,
  });
  if (res.error) return null;
  return res.data;
});

/** 404s (not redirects) if there's no platform session or it's the wrong role. */
export async function requirePlatformRole(
  role: "ADMIN" | "DEVELOPER",
): Promise<PlatformSessionUser> {
  const session = await getPlatformSession();
  if (!session || session.role !== role) notFound();
  return session;
}
