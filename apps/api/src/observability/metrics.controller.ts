// =====================================================================
// apps/api/src/observability/metrics.controller.ts
// =====================================================================
// /metrics endpoint exposing Prometheus-format counters/histograms.
// Public (no auth) but designed to be reachable only from the
// observability network (k8s ServiceMonitor scrapes pod IPs directly).
// =====================================================================

import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from "prom-client";

import { Public } from "../common/decorators/public.decorator";
import { env } from "@ibirdos/config";

// Singleton registry — register here, increment everywhere
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "ibirdos_" });

export const httpRequestsTotal = new Counter({
  name: "ibirdos_http_requests_total",
  help: "Total HTTP requests received",
  labelNames: ["method", "route", "status"],
  registers: [metricsRegistry],
});
export const httpDurationSeconds = new Histogram({
  name: "ibirdos_http_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.6, 1, 3, 6],
  registers: [metricsRegistry],
});
export const workerJobsCompleted = new Counter({
  name: "ibirdos_worker_jobs_completed_total",
  help: "Worker jobs completed",
  labelNames: ["queue", "outcome"],
  registers: [metricsRegistry],
});
export const activeSubscriptions = new Gauge({
  name: "ibirdos_active_subscriptions",
  help: "Count of subscriptions in ACTIVE or TRIALING status",
  registers: [metricsRegistry],
});

@Controller("metrics")
export class MetricsController {
  @Public()
  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4")
  async metrics(@Res({ passthrough: true }) res: Response) {
    if (!env.PROMETHEUS_ENABLED) {
      res.status(404);
      return "metrics disabled";
    }
    return metricsRegistry.metrics();
  }
}
