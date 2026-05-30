// =====================================================================
// Sentry initialization. Lazy-loaded; safe to call when SENTRY_DSN
// is missing (no-op). Captures unhandled errors with workspace/user
// scope when available.
// =====================================================================

import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("sentry");

export async function initSentry() {
  if (!env.SENTRY_DSN) {
    log.info("SENTRY_DSN not set — error reporting disabled");
    return;
  }
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      release: env.APP_VERSION,
      tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
      // Avoid sending PII; rely on request id for correlation
      sendDefaultPii: false,
      beforeSend(event) {
        // Strip authorization headers if any slipped through
        if (event.request?.headers) {
          delete (event.request.headers as any).authorization;
          delete (event.request.headers as any).cookie;
        }
        return event;
      },
    });
    log.info({ env: env.NODE_ENV }, "Sentry initialized");
  } catch (err: any) {
    log.warn({ err: err.message }, "Sentry init failed — install @sentry/node");
  }
}
