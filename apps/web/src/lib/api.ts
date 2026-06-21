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

// ---- CSRF token support ----
// The API CsrfGuard requires cookie ibirdos.csrf == X-Csrf-Token header
// on every non-GET request. The cookie is NOT HttpOnly so JS can read it.
// GET /auth/csrf issues it. We bootstrap lazily on the first mutation.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)ibirdos\.csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

// Stored token (same value as the cookie, kept in module scope so concurrent
// requests share it without racing to re-fetch).
let _csrfToken: string | null = null;
let _csrfInFlight: Promise<void> | null = null;

async function ensureCsrfToken(): Promise<string | null> {
  if (typeof window === "undefined") return null; // SSR — guard bypasses server-side calls
  if (_csrfToken) return _csrfToken;

  // Check cookie in case another tab/request already set it
  const fromCookie = readCsrfCookie();
  if (fromCookie) { _csrfToken = fromCookie; return _csrfToken; }

  // Deduplicate concurrent bootstrap calls
  if (!_csrfInFlight) {
    _csrfInFlight = fetch(`${API_BASE}/auth/csrf`, {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((json) => { _csrfToken = json?.data?.token ?? readCsrfCookie() ?? null; })
      .catch(() => { _csrfInFlight = null; }); // allow retry on next request
  }

  await _csrfInFlight;
  return _csrfToken;
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

  // Attach CSRF token on client-side mutations (not SSR — opts.cookies marks SSR calls)
  if (!SAFE_METHODS.has(method) && !opts.cookies) {
    const csrf = await ensureCsrfToken();
    if (csrf) headers["X-Csrf-Token"] = csrf;
  }

  const init: RequestInit = {
    method,
    credentials: "include",
    headers,
    cache: "no-store",
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err: any) {
    return {
      data: null,
      error: { code: "network_error", message: err?.message ?? "Network error — is the API running?" },
    };
  }

  if (res.status === 401 && !opts.noAuthRedirect && typeof window !== "undefined") {
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?next=${next}`;
  }

  // If CSRF was rejected (stale/rotated token), clear so next call re-fetches
  if (res.status === 403) {
    _csrfToken = null;
    _csrfInFlight = null;
  }

  // 204 No Content — success with no body
  if (res.status === 204) {
    return { data: null as any, error: null };
  }

  // The API always returns ApiResponse envelope, even on errors
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    console.error(`[api] non-JSON response from ${method} ${path} (status ${res.status})`);
    return {
      data: null,
      error: {
        code: "internal_error",
        message: "Something went wrong. Please try again.",
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
