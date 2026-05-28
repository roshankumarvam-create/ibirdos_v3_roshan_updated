// =====================================================================
// RBAC tests — verifies role -> permission boundaries are airtight.
// Pinned against the REAL permission names in src/index.ts.
// =====================================================================
import { describe, it, expect } from "vitest";
import { can, PERMISSIONS, ROLE_PERMISSIONS } from "../src";

describe("RBAC — OWNER", () => {
  it("has every permission", () => {
    for (const perm of PERMISSIONS) expect(can("OWNER", perm)).toBe(true);
  });
});

describe("RBAC — MANAGER", () => {
  it("can read & manage operations", () => {
    expect(can("MANAGER", "event.read")).toBe(true);
    expect(can("MANAGER", "recipe.update")).toBe(true);
    expect(can("MANAGER", "ingredient.update_cost")).toBe(true);
    expect(can("MANAGER", "workspace.update")).toBe(true); // managers CAN update workspace
  });
  it("CANNOT delete the workspace", () => {
    expect(can("MANAGER", "workspace.delete")).toBe(false);
  });
  it("can READ billing but NOT manage it", () => {
    expect(can("MANAGER", "billing.read")).toBe(true);
    expect(can("MANAGER", "billing.manage")).toBe(false);
  });
  it("CANNOT read finance analytics (owner-only)", () => {
    expect(can("MANAGER", "analytics.finance.read")).toBe(false);
  });
});

describe("RBAC — CHEF", () => {
  it("can work the kitchen & recipes", () => {
    expect(can("CHEF", "recipe.update")).toBe(true);
    expect(can("CHEF", "kitchen.update_task")).toBe(true);
    expect(can("CHEF", "waste.create")).toBe(true);
  });
  it("CANNOT commit recipe cost changes", () => {
    expect(can("CHEF", "recipe.update_cost")).toBe(false);
  });
  it("CANNOT manage users", () => {
    expect(can("CHEF", "user.create")).toBe(false);
    expect(can("CHEF", "user.update")).toBe(false);
  });
  it("CANNOT read analytics", () => {
    expect(can("CHEF", "analytics.read")).toBe(false);
    expect(can("CHEF", "analytics.finance.read")).toBe(false);
  });
});

describe("RBAC — STAFF", () => {
  it("read-only operational access", () => {
    expect(can("STAFF", "event.read")).toBe(true);
    expect(can("STAFF", "recipe.read")).toBe(true);
    expect(can("STAFF", "kitchen.read")).toBe(true);
  });
  it("CANNOT create or destroy", () => {
    expect(can("STAFF", "recipe.create")).toBe(false);
    expect(can("STAFF", "event.delete")).toBe(false);
    expect(can("STAFF", "ingredient.create")).toBe(false);
    expect(can("STAFF", "kitchen.update_task")).toBe(false);
  });
});

describe("RBAC — guards", () => {
  it("unknown role gets nothing", () => {
    expect(can("NOPE" as any, "event.read")).toBe(false);
  });
  it("every role's permissions are valid permission names", () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const perm of perms) {
        expect(PERMISSIONS.includes(perm as any), `${role} -> ${perm}`).toBe(true);
      }
    }
  });
});
