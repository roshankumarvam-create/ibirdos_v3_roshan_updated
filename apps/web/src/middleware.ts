// =====================================================================
// Next.js edge middleware — security headers + CSP for the frontend.
// =====================================================================
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const apiOrigin = new URL(apiUrl).origin;
  const wsOrigin = apiOrigin.replace(/^http/, "ws");

  // CSP — allows: self, API, websocket, inline styles (Tailwind needs them
  // because of Next's CSS-in-JS hydration; nonces would be stricter but
  // require coordination with the Next runtime).
  const csp = [
    "default-src 'self'",
    `connect-src 'self' ${apiOrigin} ${wsOrigin}`,
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline'",
    process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js inline scripts; dev needs unsafe-eval for react-refresh
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
