import { describe, it, expect } from "vitest";
import {
  getUserStatusLabel,
  getUserStatusTone,
  userStatusFromDisabled,
  USER_STATUS_LABELS,
} from "../components/common/user-status-badge";

describe("getUserStatusLabel", () => {
  it("returns 'Active' for ACTIVE", () => {
    expect(getUserStatusLabel("ACTIVE")).toBe("Active");
  });

  it("returns 'Disabled' for DISABLED", () => {
    expect(getUserStatusLabel("DISABLED")).toBe("Disabled");
  });

  it("returns 'Pending' for PENDING", () => {
    expect(getUserStatusLabel("PENDING")).toBe("Pending");
  });

  it("returns 'Invited' for INVITED", () => {
    expect(getUserStatusLabel("INVITED")).toBe("Invited");
  });

  it("returns 'Unknown Status' for null", () => {
    expect(getUserStatusLabel(null)).toBe("Unknown Status");
  });

  it("returns 'Unknown Status' for undefined", () => {
    expect(getUserStatusLabel(undefined)).toBe("Unknown Status");
  });

  it("returns 'Unknown Status' for unrecognized value", () => {
    expect(getUserStatusLabel("BANISHED")).toBe("Unknown Status");
  });
});

describe("getUserStatusTone", () => {
  it("returns 'success' for ACTIVE", () => {
    expect(getUserStatusTone("ACTIVE")).toBe("success");
  });

  it("returns 'danger' for DISABLED", () => {
    expect(getUserStatusTone("DISABLED")).toBe("danger");
  });

  it("returns 'warning' for PENDING", () => {
    expect(getUserStatusTone("PENDING")).toBe("warning");
  });

  it("returns 'neutral' for INVITED", () => {
    expect(getUserStatusTone("INVITED")).toBe("neutral");
  });

  it("returns 'neutral' for null", () => {
    expect(getUserStatusTone(null)).toBe("neutral");
  });
});

describe("userStatusFromDisabled", () => {
  it("returns ACTIVE when disabled=false", () => {
    expect(userStatusFromDisabled(false)).toBe("ACTIVE");
  });

  it("returns DISABLED when disabled=true", () => {
    expect(userStatusFromDisabled(true)).toBe("DISABLED");
  });
});

describe("USER_STATUS_LABELS", () => {
  it("has non-empty labels for all expected status values", () => {
    const expected = ["ACTIVE", "DISABLED", "PENDING", "INVITED"];
    for (const s of expected) {
      expect(USER_STATUS_LABELS[s]).toBeTruthy();
      expect(typeof USER_STATUS_LABELS[s]).toBe("string");
    }
  });
});
