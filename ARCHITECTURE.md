# IBirdOS V3 — Architecture

This document is the contract every future phase obeys. If a future phase wants to break a rule here, that's an explicit ADR in `docs/adr/`, not a quiet local exception.

---

## 1. Modular monolith, not microservices

One deployable artifact for the API (one NestJS process), one for the web (Next.js). Internal module boundaries are real and enforced through:

- **Package dependency graph** — `packages/permissions` cannot import from `packages/db` (it must be importable in Edge runtime). `packages/types` has zero runtime dependencies on `@prisma/client`. The lint rules in Phase 4 enforce these graphs.
- **Domain module isolation** — `apps/api/src/modules/invoices/` cannot import from `apps/api/src/modules/recipes/`. Cross-domain communication goes through emitted events on the BullMQ bus (Phase 6). When an invoice is confirmed, it emits `invoice.confirmed`; the recipe module subscribes and recosts. The two modules never reach into each other's code.

This means we can extract a hot module (say, the AI extraction worker) into its own service later without rewriting domain code.

---

## 2. Tenant isolation is structural, not procedural

Procedural defense: "remember to filter by workspaceId." This fails the moment a developer is tired or new.

Structural defense: the only way to query a tenant-scoped table is through a repository that requires the tenant context as a constructor argument. The signature makes the leak impossible:

```ts
// Impossible by construction — repository methods cannot run without ctx
const invoices = await tenantScoped(prisma.invoice, ctx).findMany({
  where: { status: "PENDING_REVIEW" },
});
// workspaceId is appended to where automatically
```

The raw `prisma` client is allowed in **two** places only:
- `apps/api/src/auth/*` — login flow needs to look up users by username globally
- `apps/api/src/admin/*` — superadmin/support tools that legitimately cross tenants

Code review rejects any other file importing `prisma` directly.

---

## 3. RBAC is a matrix, not scattered conditionals

The bad pattern: `if (user.role === "MANAGER" || user.role === "OWNER") { ... }` sprinkled through controllers. Three problems:
- Adding a new role means hunting through the codebase.
- Adding a new permission to MANAGER but not OWNER (rare but happens) means more conditionals.
- The spec's strict invariants (CHEF never sees finance, MANAGER never sees billing) are not enforceable as a single check.

The good pattern: one matrix in `packages/permissions`, one function (`can(role, permission)`), one guard (`@RequireRole(Role.MANAGER)` checks the matrix). The matrix has runtime assertions at module load that enforce spec invariants. Compile or boot fails if someone accidentally grants CHEF financial visibility.

---

## 4. Ingredients are the single source of truth

Every cost in the system traces back to an ingredient's `currentCostPerUnit`. When that field changes — via invoice confirmation, vendor API, or manual edit — the change emits an event:

```
ingredient.cost_changed
  → recipe.recost (every recipe using that ingredient)
    → event.recost (every upcoming event using that recipe)
      → menu.pricing_alert (every menu item with degraded margin)
        → ai.advice (generate price-raise / vendor-switch suggestions)
```

This cascade is the heart of the product. It's why the schema in Phase 5 includes `IngredientPriceHistory` and why the recipe schema in Phase 9 stores `ingredientCostSnapshot` per line — so we can recompute deterministically and explain why a recipe costs what it does.

---

## 5. AI outputs are reviewable, editable, and auditable

Per spec: "Never fully trust AI blindly." Every AI extraction (invoice OCR, recipe parsing, ingredient matching) produces:

1. A **proposal record** — what the AI extracted, with confidence scores per field
2. A **review UI** — pre-populated, editable, with a single "Confirm" button that commits the proposal as the source of truth
3. An **audit entry** — the original AI output, the human edits, and who confirmed

This is why every AI table in domain phases will follow the pattern: `*ExtractionProposal` (AI output) → `*Confirmation` (human review) → domain entity (committed).

---

## 6. Events drive cross-module coordination

Cross-domain effects flow through a typed event bus on BullMQ. This is built in Phase 6 (Invoice AI) when the first real cascade happens. The contract:

- Events are **past tense** and **descriptive**: `invoice.confirmed`, `recipe.recosted`, not `recipe.recost` (imperative).
- Event payloads are versioned. Adding a field is fine; renaming or removing requires a `v2` event and a deprecation cycle.
- Subscribers are **idempotent**. The same event delivered twice produces the same result. (BullMQ guarantees at-least-once, not exactly-once.)
- Subscribers run in **workers**, not in request handlers. A user confirming an invoice returns 200 immediately; recipe recosting happens in the background and emits its own completion events.

This means realtime updates (Phase 17) work for free: the same event that triggers a recompute is fanned out to connected websocket clients.

---

## 7. Background work is not opportunistic

Anything taking more than ~200ms doesn't run in a request handler. AI extraction, recipe recosting, vendor catalog imports, forecast computation — all jobs on the BullMQ queue. Workers run as a separate Node process (`pnpm dev:workers`) in the same `apps/api` codebase, sharing modules.

This means:
- Failed jobs retry with exponential backoff.
- Slow jobs don't time out HTTP requests.
- Horizontal scale = add more worker pods; the queue handles distribution.

---

## 8. Audit logs are not optional

Every meaningful mutation calls `writeAudit(ctx, entry)` after the transaction commits. The action name is a dotted verb-past-tense: `invoice.confirmed`, `user.role_changed`, `ingredient.price_updated`. The metadata field is JSONB and stores the before/after values for the changed fields.

This serves three purposes:
- **Compliance** — SOC 2 audit log
- **Debugging** — "who changed the chicken price last week?"
- **Undo** — Phase 19 builds a generic revert flow that reads from this table

---

## 9. Design system is the law

One dark luxury aesthetic. Defined in `packages/ui/src/tokens.ts` (Phase 3) and consumed by every component. No inline `style={{ color: '#fff' }}`. No alternate light themes. No "I'll make this page cream because it's invoices."

The old V2 build had a cream/ivory Invoices page on an otherwise dark shell. That's the kind of drift the design system in Phase 3 eliminates by making token usage the path of least resistance and inline colors the path of friction.

---

## 10. Conventions

- **Naming**: tables snake_case, columns snake_case, TS types PascalCase, files kebab-case for components, camelCase for utilities
- **Errors**: throw a typed `IbirdosError(code, message, { details })`; the API exception filter renders it as the standard envelope
- **Validation**: every request body parsed through a Zod schema from `packages/types`; never trust client input
- **Time**: store `DateTime` in UTC, render in the workspace's timezone (set in `Workspace.settings.timezone`)
- **Money**: store as integer cents (`amountCents`) — never floats. Display formatting happens in the UI.
- **Quantities**: store in canonical units (grams for mass, milliliters for volume — see Phase 6's unit engine), display in workspace-preferred units

---

## What this architecture rejects

Things that would seem reasonable but break the model:

- **A "god service"** that wraps every domain (`PlatformService`) — domain modules talk through events, not through a router.
- **Reading roles from JWT claims without consulting the DB** — roles change; sessions live for hours. Always read the live `Membership.role` from the session.
- **GraphQL with N+1 dataloaders** — REST is fine; the data is hierarchical and the gains from GraphQL don't justify the complexity for a single web client.
- **Microservices** — premature decomposition. The modular monolith can be split later; the reverse is much harder.
- **Multi-region active-active** — Postgres primary in one region, read replicas where needed. Kitchen ops don't need sub-50ms global latency.
