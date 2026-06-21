import { describe, it, expect } from "vitest";
import { getRoleLabel, getRoleTone, ROLE_LABELS } from "../components/common/role-badge";

describe("getRoleLabel", () => {
  it("returns 'Owner' for OWNER role", () => {
    expect(getRoleLabel("OWNER")).toBe("Owner");
  });

  it("returns 'Manager' for MANAGER role", () => {
    expect(getRoleLabel("MANAGER")).toBe("Manager");
  });

  it("returns 'Chef' for CHEF role", () => {
    expect(getRoleLabel("CHEF")).toBe("Chef");
  });

  it("returns 'Staff' for STAFF role", () => {
    expect(getRoleLabel("STAFF")).toBe("Staff");
  });

  it("returns 'Unknown Role' for null", () => {
    expect(getRoleLabel(null)).toBe("Unknown Role");
  });

  it("returns 'Unknown Role' for undefined", () => {
    expect(getRoleLabel(undefined)).toBe("Unknown Role");
  });

  it("returns 'Unknown Role' for unrecognized role", () => {
    expect(getRoleLabel("RANDO")).toBe("Unknown Role");
  });
});

describe("getRoleTone", () => {
  it("returns 'accent' for OWNER", () => {
    expect(getRoleTone("OWNER")).toBe("accent");
  });

  it("returns 'success' for CHEF", () => {
    expect(getRoleTone("CHEF")).toBe("success");
  });

  it("returns 'neutral' for null", () => {
    expect(getRoleTone(null)).toBe("neutral");
  });

  it("returns 'neutral' for undefined", () => {
    expect(getRoleTone(undefined)).toBe("neutral");
  });
});

describe("ROLE_LABELS", () => {
  it("has labels for all expected role values", () => {
    const expected = ["OWNER", "MANAGER", "CHEF", "STAFF", "CUSTOMER"];
    for (const role of expected) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("all labels are non-empty strings", () => {
    for (const [, label] of Object.entries(ROLE_LABELS)) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
