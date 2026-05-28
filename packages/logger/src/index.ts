// =====================================================================
// IBirdOS V3 — packages/logger
// =====================================================================
// Structured logging with pino. Every service gets a child logger
// scoped to its module name. Request middleware (Phase 4) attaches a
// request-id that flows through every log line for that request.
//
// Usage:
//   import { logger } from "@ibirdos/logger";
//   const log = logger.child({ module: "InvoicesService" });
//   log.info({ invoiceId }, "invoice confirmed");
//
// Output:
//   {"level":30,"time":...,"module":"InvoicesService","invoiceId":"...","msg":"invoice confirmed"}
// =====================================================================

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const baseOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  base: {
    service: "ibirdos",
    env: process.env.NODE_ENV ?? "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,

  // Redact secret-bearing keys at the structured-log level.
  // Never trust callers to remember not to log a password.
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "tokenHash",
      "authorization",
      "cookie",
      "*.password",
      "*.passwordHash",
      "*.token",
      "headers.authorization",
      "headers.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
};

// Pretty-print in dev only; production gets newline-delimited JSON for
// log aggregators (Datadog, Loki, CloudWatch). We attach `transport`
// conditionally rather than setting it to `undefined`, because the repo
// uses exactOptionalPropertyTypes — an explicit `undefined` is a type error.
if (isDev) {
  baseOptions.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      ignore: "pid,hostname,service,env",
      singleLine: false,
    },
  };
}

export const logger = pino(baseOptions);

export type Logger = typeof logger;

/**
 * Create a child logger bound to a specific module name. Domain
 * services should do this once at module load and reuse the child.
 */
export function moduleLogger(moduleName: string): Logger {
  return logger.child({ module: moduleName });
}
