// =====================================================================
// IBirdOS V3 — packages/permissions
// =====================================================================
// The single source of truth for "who can do what."
//
// Every future domain module extends the Permission union with its
// own actions (e.g. "invoice.confirm", "recipe.update_cost"), and
// adds entries to ROLE_PERMISSIONS. The RbacGuard in apps/api and
// the useCan() hook in apps/web both read from this table.
//
// DO NOT scatter permission checks inline ("if (role === OWNER)") —
// every check MUST go through can() so the matrix stays auditable.
// =====================================================================

export type Role = "OWNER" | "MANAGER" | "CHEF" | "STAFF" | "CUSTOMER";

// ---------------------------------------------------------------------
// Permission catalog
// ---------------------------------------------------------------------
// Format: "<resource>.<action>"
// Resources match domain module names; actions are verbs.
// Phase 1 covers only workspace/user/membership. Future phases append:
//   - Phase 5: ingredient.create, ingredient.update_price, ingredient.delete
//   - Phase 6: invoice.upload, invoice.review, invoice.confirm
//   - Phase 7: recipe.create, recipe.upload, recipe.update_cost
//   - ...
// ---------------------------------------------------------------------

export const PERMISSIONS = [
  // Workspace
  "workspace.read",
  "workspace.update",
  "workspace.delete",
  "workspace.billing.read",
  "workspace.billing.update",

  // Users & memberships
  "user.create",
  "user.read",
  "user.update",
  "user.delete",
  "user.reset_password",
  "membership.create",
  "membership.update_role",
  "membership.suspend",


  // Vendors (Phase 5)
  "vendor.create", "vendor.read", "vendor.update", "vendor.delete",

  // Ingredients (Phase 5)
  "ingredient.create",
  "ingredient.read",
  "ingredient.update",
  "ingredient.update_cost",     // OWNER+MANAGER only — financial
  "ingredient.delete",
  "ingredient.match",            // alias resolution; used by invoice UI
  "ingredient.merge",            // merge duplicate ingredients (OWNER)

  // Invoices (Phase 6)
  "invoice.upload",
  "invoice.read",
  "invoice.review",
  "invoice.confirm",
  "invoice.delete",

  // Recipes (Phase 7)
  "recipe.create",
  "recipe.read",
  "recipe.update",
  "recipe.update_cost",          // OWNER+MANAGER (chefs propose; managers commit)
  "recipe.delete",


  // Events (Phase 9)
  "event.create",
  "event.read",
  "event.update",
  "event.delete",
  "event.assign_staff",
  // Kitchen (Phase 10)
  "kitchen.read",
  "kitchen.update_task",

  // Yield & Waste (Phase 11)
  "yield.create", "yield.read",
  "waste.create", "waste.read",

  // Insights (Production)
  "insight.read",
  "insight.action",
  // Analytics & Finance (Phase 12)
  "analytics.read",
  "analytics.finance.read",   // P&L, COGS — owner-only by default

  // Billing (Production)
  "billing.read",
  "billing.manage",
  // Customer Ordering (Phase 13)
  "customer.order.create",
  "customer.order.read",

  // Inventory (Phase 8)
  "inventory.read",
  "inventory.adjust",
  "inventory.transfer",

  // Audit
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ---------------------------------------------------------------------
// Role → permissions matrix
// ---------------------------------------------------------------------
// Strictness per spec:
//   OWNER    — everything
//   MANAGER  — operations + user management, NO billing, NO workspace.delete
//   CHEF     — kitchen-only (added in domain phases); zero workspace admin
//   STAFF    — minimal operational
//   CUSTOMER — external only
// ---------------------------------------------------------------------

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>(PERMISSIONS),

  MANAGER: new Set<Permission>([
    "workspace.read", "workspace.update",
    "user.create", "user.read", "user.update", "user.reset_password",
    "membership.create", "membership.update_role", "membership.suspend",
    "audit.read",
    // Vendors
    "vendor.create", "vendor.read", "vendor.update", "vendor.delete",
    // Ingredients — full operational control INCLUDING cost
    "ingredient.create", "ingredient.read", "ingredient.update",
    "ingredient.update_cost", "ingredient.delete", "ingredient.match",
    // Invoices
    "invoice.upload", "invoice.read", "invoice.review", "invoice.confirm",
    // Recipes (cost commit too)
    "recipe.create", "recipe.read", "recipe.update", "recipe.update_cost",
    // Inventory
    "inventory.read", "inventory.adjust", "inventory.transfer",
    // Events
    "event.create", "event.read", "event.update", "event.delete", "event.assign_staff",
    // Kitchen
    "kitchen.read", "kitchen.update_task",
    // Yield & Waste
    "yield.create", "yield.read", "waste.create", "waste.read",
    // Analytics
    "analytics.read",   // operational analytics; finance still owner-only
    "insight.read", "insight.action",
    // Billing — managers can READ but not change plan
    "billing.read",
  ]),

  CHEF: new Set<Permission>([
    "workspace.read",
    "user.read", // can see kitchen colleagues for assignment
    // Read-only kitchen access. NO cost visibility, NO writes that
    // would affect financials. Chefs can propose recipes (recipe.create)
    // and log yield, but not commit cost changes (no recipe.update_cost).
    "ingredient.read", "ingredient.match",
    "recipe.create", "recipe.read", "recipe.update",
    "inventory.read",
    // Chef sees events they're assigned to + kitchen tasks
    "event.read",
    "kitchen.read", "kitchen.update_task",
    "yield.create", "yield.read", "waste.create", "waste.read",
  ]),

  STAFF: new Set<Permission>([
    "workspace.read", "user.read",
    "ingredient.read", "recipe.read", "inventory.read",
    "event.read", "kitchen.read",
  ]),

  CUSTOMER: new Set<Permission>([
    // Customers do not have workspace-admin permissions.
    // Customer-facing actions (place_order, view_menu) are added
    // to PERMISSIONS in the ordering phase.
  ]),
};

// ---------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------

/**
 * The single permission check used by RbacGuard, useCan(), and any
 * server action that needs to verify authorization.
 *
 * @example
 *   if (!can(membership.role, "invoice.confirm")) {
 *     throw new ForbiddenException();
 *   }
 */
export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/**
 * Check multiple permissions at once. Returns true only if the role
 * has ALL the listed permissions.
 */
export function canAll(role: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => can(role, p));
}

/**
 * Check if a role has ANY of the listed permissions.
 */
export function canAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

/**
 * Roles that include a given permission. Useful for "assignable to"
 * lookups (e.g., "who can be assigned to review this invoice?").
 */
export function rolesWith(permission: Permission): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
    can(role, permission),
  );
}

// ---------------------------------------------------------------------
// Spec invariants — enforced at compile time + runtime
// ---------------------------------------------------------------------
// The platform spec is strict about certain visibility rules.
// These assertions document and enforce them.
// ---------------------------------------------------------------------

const FINANCIAL_PERMISSIONS: Permission[] = [
  "workspace.billing.read",
  "workspace.billing.update",
];

// Spec: CHEF has NO financial visibility. Ever.
if (FINANCIAL_PERMISSIONS.some((p) => can("CHEF", p))) {
  throw new Error(
    "Permission matrix violates spec: CHEF must not have financial permissions.",
  );
}

// Spec: only OWNER can access billing.
if (FINANCIAL_PERMISSIONS.some((p) => can("MANAGER", p))) {
  throw new Error(
    "Permission matrix violates spec: MANAGER must not have billing permissions.",
  );
}

// Spec invariant: CHEF must not have ingredient.update_cost
if (can("CHEF", "ingredient.update_cost")) {
  throw new Error("Permission matrix violates spec: CHEF must not be able to update ingredient costs.");
}
// Spec invariant: CHEF must not have recipe.update_cost
if (can("CHEF", "recipe.update_cost")) {
  throw new Error("Permission matrix violates spec: CHEF must not be able to update recipe costs.");
}
