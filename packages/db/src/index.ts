// =====================================================================
// IBirdOS V3 — packages/db
// =====================================================================
// Exports:
//   - prisma:         the singleton Prisma client (use sparingly; prefer
//                     TenantScopedRepository for any tenant-scoped table)
//   - TenantContext:  the (workspaceId, userId) tuple that every request
//                     must carry
//   - tenantScoped(): factory that wraps a Prisma delegate so every
//                     where-clause is automatically tenant-filtered
//
// The point of this module is to make tenant leaks IMPOSSIBLE by
// construction. Domain code never reaches for prisma.invoice.findMany();
// it reaches for repos.invoice.findMany() which cannot be called
// without a workspaceId in scope.
// =====================================================================

import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------
// Singleton — survives Next.js hot reload
// ---------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __ibirdos_prisma__: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__ibirdos_prisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production"
      ? ["warn", "error"]
      : ["query", "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__ibirdos_prisma__ = prisma;
}

// ---------------------------------------------------------------------
// Tenant context
// ---------------------------------------------------------------------
// Constructed by TenantGuard in apps/api from the session. Passed
// explicitly into every service call. NEVER read from a global or
// AsyncLocalStorage in domain code — explicit is safer.
// ---------------------------------------------------------------------

export interface TenantContext {
  workspaceId: string;
  userId: string;
  role: "OWNER" | "MANAGER" | "CHEF" | "STAFF" | "CUSTOMER";
}

// ---------------------------------------------------------------------
// TenantScopedRepository factory
// ---------------------------------------------------------------------
// Wraps a Prisma delegate so every read/write is automatically scoped
// to ctx.workspaceId. The caller cannot forget the filter because the
// methods themselves require the context.
//
// Soft delete is also respected: findMany/findFirst exclude rows where
// deletedAt is set, unless { includeDeleted: true } is passed.
//
// Usage in a domain service:
//
//   const ingredientRepo = tenantScoped(prisma.ingredient, ctx);
//   const ingredients = await ingredientRepo.findMany({
//     where: { lowStock: true },  // workspaceId added automatically
//   });
//
// SOFT BYPASS (rare, for cross-tenant admin/superadmin operations):
//   You must explicitly import { prisma } and document why. Code review
//   should reject any non-admin file that imports the raw prisma client.
// ---------------------------------------------------------------------

type WithWorkspaceId<T> = T & { workspaceId: string };

type AnyDelegate = {
  findMany:   (args?: any) => any;
  findFirst:  (args?: any) => any;
  findUnique: (args?: any) => any;
  create:     (args:  any) => any;
  update:     (args:  any) => any;
  updateMany: (args:  any) => any;
  delete:     (args:  any) => any;
  deleteMany: (args?: any) => any;
  count:      (args?: any) => any;
};

export function tenantScoped<D extends AnyDelegate>(
  delegate: D,
  ctx: TenantContext,
) {
  const scope = { workspaceId: ctx.workspaceId };

  const mergeWhere = (where: any = {}, includeDeleted = false) => {
    const base = { ...where, ...scope };
    if (!includeDeleted && !("deletedAt" in base)) {
      base.deletedAt = null;
    }
    return base;
  };

  return {
    /**
     * findMany scoped to the current workspace. Soft-deleted rows
     * excluded by default; pass { includeDeleted: true } to override.
     */
    findMany: (args: any = {}) =>
      delegate.findMany({
        ...args,
        where: mergeWhere(args.where, args.includeDeleted),
      }),

    findFirst: (args: any = {}) =>
      delegate.findFirst({
        ...args,
        where: mergeWhere(args.where, args.includeDeleted),
      }),

    /**
     * findUnique is dangerous in multi-tenant — a CUID is globally
     * unique so the row WOULD return regardless of workspace. We force
     * findFirst with the workspace filter instead.
     */
    findUniqueWithinWorkspace: (where: { id: string }) =>
      delegate.findFirst({ where: mergeWhere(where) }),

    create: (args: { data: any; [k: string]: any }) =>
      delegate.create({
        ...args,
        data: {
          ...args.data,
          workspaceId: ctx.workspaceId,
          createdById: ctx.userId,
        },
      }),

    update: (args: { where: any; data: any; [k: string]: any }) =>
      delegate.update({
        ...args,
        where: mergeWhere(args.where),
      }),

    updateMany: (args: { where?: any; data: any }) =>
      delegate.updateMany({
        ...args,
        where: mergeWhere(args.where),
      }),

    /**
     * Soft delete by default. Hard delete must be requested explicitly.
     */
    softDelete: (where: { id: string }) =>
      delegate.update({
        where: mergeWhere(where),
        data: { deletedAt: new Date() },
      }),

    hardDelete: (where: { id: string }) =>
      delegate.delete({ where: mergeWhere(where) }),

    count: (args: any = {}) =>
      delegate.count({
        ...args,
        where: mergeWhere(args.where, args.includeDeleted),
      }),
  };
}

// ---------------------------------------------------------------------
// Audit log helper — every mutation should call this
// ---------------------------------------------------------------------

export interface AuditEntry {
  action: string;       // dotted: "invoice.confirmed"
  entityType: string;   // "Invoice"
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAudit(
  ctx: TenantContext,
  entry: AuditEntry,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: (entry.metadata ?? {}) as any,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}

// Re-export Prisma types for convenience
export * from "@prisma/client";
