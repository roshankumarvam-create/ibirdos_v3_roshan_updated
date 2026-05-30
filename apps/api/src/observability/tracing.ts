// =====================================================================
// OpenTelemetry + Sentry initialization.
// =====================================================================
// MUST be required FIRST in main.ts before any other module that
// might create spans (Nest, Prisma, ioredis). Otherwise the
// auto-instrumentation hooks are installed after the libraries are
// already loaded and traces won't be captured.
// =====================================================================

import { env } from "@ibirdos/config";
import { logger } from "@ibirdos/logger";

const log = logger.child({ module: "tracing" });

export async function initTracing() {
  // ---- Sentry ----
  if (env.SENTRY_DSN) {
    try {
      const Sentry = await import("@sentry/node");
      Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
        // Don't capture request bodies — risk of PII leakage. Stack
        // traces + breadcrumbs are sufficient.
        sendDefaultPii: false,
      });
      log.info("Sentry initialized");
    } catch (err: any) {
      log.warn({ err: err.message }, "Sentry init failed — continuing without");
    }
  }

  // ---- OpenTelemetry ----
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    try {
      const { NodeSDK } = await import("@opentelemetry/sdk-node");
      const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
      const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
      const { Resource } = await import("@opentelemetry/resources");
      const { SemanticResourceAttributes } = await import("@opentelemetry/semantic-conventions");

      const sdk = new NodeSDK({
        resource: new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: "ibirdos-api",
          [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION ?? "dev",
          [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env.NODE_ENV,
        }),
        traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
        instrumentations: [getNodeAutoInstrumentations({
          // Disable noisy instrumentations
          "@opentelemetry/instrumentation-fs": { enabled: false },
        })],
      });
      sdk.start();
      log.info({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }, "OpenTelemetry initialized");

      // Graceful shutdown
      const shutdown = async () => { await sdk.shutdown(); };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    } catch (err: any) {
      log.warn({ err: err.message }, "OTel init failed — continuing without");
    }
  }
}
