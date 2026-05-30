// =====================================================================
// apps/api/src/workers/main.ts
// =====================================================================
// Worker process entry. Run with: pnpm dev:workers
// Imports each worker file so a single process handles all queues in
// dev. Production scales horizontally by replica count.
// =====================================================================

import { env } from "@ibirdos/config";
import { logger } from "@ibirdos/logger";

import "./invoice-extraction.worker";   // Phase 6 — OpenAI Vision OCR
import "./recipe-recost.worker";        // Phase 7 — auto-recost on cost_changed/invoice.confirmed
import "./insights-generator.worker"; // PC — daily AI insights

logger.info({ env: env.NODE_ENV }, "workers running");
