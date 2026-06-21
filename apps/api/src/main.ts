// Tracing must be imported FIRST so auto-instrumentation patches libs
import { initTracing } from "./observability/tracing";
// Fire-and-forget: the SDK patches modules on import; commonjs forbids top-level await.
void initTracing();

// BigInt serialization — Prisma returns BigInt for microcents fields; patch JSON so
// Express can serialize them. Values stay within Number.MAX_SAFE_INTEGER for our use case.
(BigInt.prototype as any).toJSON = function () { return Number(this); };

// =====================================================================
// apps/api/src/main.ts
// =====================================================================

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import { env } from "@ibirdos/config";
import { logger } from "@ibirdos/logger";

import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

import { initSentry } from "./observability/sentry.init";
import { initOtel } from "./observability/otel.init";

async function bootstrap() {
  await initOtel();
  await initSentry();
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: ["error", "warn", "log"], // NestJS noise reduced; we use pino for app logs
    bodyParser: true,
  });

  // ---- Security middleware ----
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === "production" ? {
        directives: {
          defaultSrc: ["'self'"],
          formAction: ["'self'", env.WEB_URL, env.API_URL],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          fontSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", env.WEB_URL, env.API_URL, "https://*.r2.cloudflarestorage.com", "wss://*.ibirdos.com"],
          frameSrc: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      } : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());

  // ---- CORS — allow the web app, credentials enabled for cookies ----
  app.enableCors({
    origin: env.WEB_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Csrf-Token"],
  });

  // ---- Global API prefix ----
  app.setGlobalPrefix("api/v1");

  // ---- Global exception filter — friendly JSON for all errors, no path leakage ----
  app.useGlobalFilters(new HttpExceptionFilter());

  // ---- Graceful shutdown for k8s ----
  // Prometheus metrics — record each HTTP request
  const { MetricsService } = await import("./observability/metrics.service");
  const metrics = app.get(MetricsService);
  app.use(metrics.httpMiddleware());

  app.enableShutdownHooks();

  // Extra cleanup: drain in-flight requests, close DB, redis
  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, "graceful shutdown starting");
    try { await app.close(); } catch (e) { logger.error({ err: e }, "shutdown error"); }
    process.exit(0);
  };
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => logger.fatal({ reason }, "unhandled promise rejection"));
  process.on("uncaughtException",  (err) => { logger.fatal({ err: err.message, stack: err.stack }, "uncaught exception"); process.exit(1); });

  const port = Number(new URL(env.API_URL).port) || 3001;
  await app.listen(port);
  logger.info({ port, env: env.NODE_ENV }, "API listening");
}

bootstrap().catch((err) => {
  logger.fatal({ err }, "API failed to start");
  process.exit(1);
});
