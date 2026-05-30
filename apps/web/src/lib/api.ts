// =====================================================================
// apps/web/src/lib/api.ts
// =====================================================================
// The ONE way the web app calls the API. Wraps fetch so:
//   - cookies are always sent (credentials: include)
//   - JSON parsing is automatic
//   - the ApiResponse envelope is unwrapped consistently
//   - 401s trigger a redirect to /login (client-side)
//   - server-side calls forward the incoming cookie header
//
// Usage on the client:
//   const res = await api.post("/auth/login", { username, password });
//   if (res.error) toast.error(res.error.message);
//
// Usage on the server (RSC):
//   const res = await api.get("/auth/me", { cookies: cookies() });
// =====================================================================

import type { ApiResponse } from "@ibirdos/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const API_BASE = `${API_URL}/api/v1`;

interface ApiOptions {
  /**
   * On the server, pass the Next.js cookies() object so the API
   * call includes the user's session cookie. On the client this is
   * not needed — credentials: include handles it.
   */
  cookies?: { toString: () => string };

  /**
   * Skip the automatic /login redirect on 401. Used by /auth/me when
   * we want to check whether the user is logged in without bouncing.
   */
  noAuthRedirect?: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: ApiOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.cookies) {
    headers["Cookie"] = opts.cookies.toString();
  }

  const init: RequestInit = {
    method,
    credentials: "include",
    headers,
    cache: "no-store",
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, init);

  if (res.status === 401 && !opts.noAuthRedirect && typeof window !== "undefined") {
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?next=${next}`;
  }

  // The API always returns ApiResponse envelope, even on errors
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return {
      data: null,
      error: {
        code: "internal_error",
        message: `Server returned non-JSON response (status ${res.status})`,
      },
    };
  }
}

export const api = {
  get:    <T>(path: string,           opts?: ApiOptions) => request<T>("GET",    path, undefined, opts),
  post:   <T>(path: string, body?: unknown, opts?: ApiOptions) => request<T>("POST",   path, body, opts),
  put:    <T>(path: string, body?: unknown, opts?: ApiOptions) => request<T>("PUT",    path, body, opts),
  patch:  <T>(path: string, body?: unknown, opts?: ApiOptions) => request<T>("PATCH",  path, body, opts),
  delete: <T>(path: string,           opts?: ApiOptions) => request<T>("DELETE", path, undefined, opts),
};
