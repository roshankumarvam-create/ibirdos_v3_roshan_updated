// =====================================================================
// apps/web/src/lib/session.ts
// =====================================================================
// Server-side session helpers. Use in Server Components and Route
// Handlers to read the current user. Caches per-request to avoid
// hitting /auth/me multiple times in one render.
// =====================================================================

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { SessionUser } from "@ibirdos/types";
import { api } from "./api";

/**
 * Returns the current session user, or null if not authenticated.
 * Cached per render via React's cache().
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const c = await cookies();
  const res = await api.get<{ user: SessionUser }>("/auth/me", {
    cookies: c,
    noAuthRedirect: true,
  });
  if (res.error) return null;
  return res.data.user;
});

/**
 * Returns the current session user, or redirects to /login.
 * Use in protected Server Components.
 */
export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Returns the current session user, redirects to /login if missing,
 * or to /403 if the user's role isn't in the allowed list.
 */
export async function requireRole(
  allowed: SessionUser["role"][],
): Promise<SessionUser> {
  const user = await requireSession();
  if (!allowed.includes(user.role)) redirect("/403");
  return user;
}
