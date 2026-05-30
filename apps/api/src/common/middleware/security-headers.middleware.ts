// =====================================================================
// Security headers middleware.
// =====================================================================
// Applied globally to every response. Headers based on OWASP best
// practices for SaaS APIs serving a SPA frontend.
//
// NOTE: CSP `connect-src 'self'` would block the SPA from calling
// api.ibirdos.com — handled by setting APP_URL + API_URL into the
// directive at boot time.
// =====================================================================
import { Injectable, NestMiddleware } from "@nestjs/common";
import { env } from "@ibirdos/config";

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: any, res: any, next: any) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(self)");
    res.setHeader("X-XSS-Protection", "0"); // modern browsers — disable legacy filter
    // HSTS — only set if we know TLS is terminated upstream
    if (env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    // CSP — strict for API responses (browsers shouldn't render API responses)
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    next();
  }
}
