// =====================================================================
// OpenTelemetry initialization. When OTEL_EXPORTER_OTLP_ENDPOINT is
// set, registers tracing for HTTP, Postgres, Redis, BullMQ. No-op
// otherwise.
// =====================================================================

import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("otel");

export async function initOtel() {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    log.debug("OTEL endpoint not set — tracing disabled");
    return;
  }
  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");

    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
      instrumentations: [getNodeAutoInstrumentations({
        // Reduce noise: drop file-system and DNS instrumentation
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      })],
      serviceName: "ibirdos-api",
    });
    sdk.start();
    log.info({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }, "OpenTelemetry initialized");

    process.on("SIGTERM", () => { sdk.shutdown().catch(() => {}); });
  } catch (err: any) {
    log.warn({ err: err.message }, "OTel init failed — install @opentelemetry/sdk-node + exporters");
  }
}
