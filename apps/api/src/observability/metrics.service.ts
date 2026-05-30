// =====================================================================
// Prometheus metrics service. Exposes counters / histograms.
// =====================================================================
// Production observability layer. Metrics are scraped by Prometheus
// (or any compatible scraper) at GET /metrics. Each request flows
// through the HTTP histogram, and domain operations emit explicit
// counters from the relevant service.
// =====================================================================

import { Injectable } from "@nestjs/common";
import client, { Registry, Counter, Histogram, Gauge } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry: Registry;
  readonly httpRequestDuration: Histogram<string>;
  readonly httpRequestsTotal: Counter<string>;
  readonly aiCostCentsTotal: Counter<string>;
  readonly invoicesProcessed: Counter<string>;
  readonly recipesRecosted: Counter<string>;
  readonly activeWorkspaces: Gauge<string>;
  readonly bullmqJobsTotal: Counter<string>;

  constructor() {
    this.registry = new Registry();
    client.collectDefaultMetrics({ register: this.registry, prefix: "ibirdos_" });

    this.httpRequestDuration = new Histogram({
      name: "ibirdos_http_request_duration_seconds",
      help: "HTTP request latency in seconds",
      labelNames: ["method", "route", "status"],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: "ibirdos_http_requests_total",
      help: "Total HTTP requests",
      labelNames: ["method", "route", "status"],
      registers: [this.registry],
    });

    this.aiCostCentsTotal = new Counter({
      name: "ibirdos_ai_cost_cents_total",
      help: "Cumulative AI cost in cents",
      labelNames: ["model", "operation"],
      registers: [this.registry],
    });

    this.invoicesProcessed = new Counter({
      name: "ibirdos_invoices_processed_total",
      help: "Invoices processed by status",
      labelNames: ["status"],
      registers: [this.registry],
    });

    this.recipesRecosted = new Counter({
      name: "ibirdos_recipes_recosted_total",
      help: "Recipe recost operations",
      labelNames: ["trigger"],
      registers: [this.registry],
    });

    this.activeWorkspaces = new Gauge({
      name: "ibirdos_active_workspaces",
      help: "Currently active workspaces",
      registers: [this.registry],
    });

    this.bullmqJobsTotal = new Counter({
      name: "ibirdos_bullmq_jobs_total",
      help: "BullMQ jobs by queue and outcome",
      labelNames: ["queue", "outcome"],
      registers: [this.registry],
    });
  }

  /** Express middleware to record per-request metrics */
  httpMiddleware() {
    return (req: any, res: any, next: any) => {
      const start = process.hrtime.bigint();
      res.on("finish", () => {
        const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
        const route = req.route?.path ?? req.path;
        const status = String(res.statusCode);
        this.httpRequestDuration.observe({ method: req.method, route, status }, durationSec);
        this.httpRequestsTotal.inc({ method: req.method, route, status });
      });
      next();
    };
  }
}
