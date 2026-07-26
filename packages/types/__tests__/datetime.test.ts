import { describe, it, expect } from "vitest";
import { formatDateOnly, toDateOnlyInputValue, formatWorkspaceDate } from "../src/datetime";

const PACIFIC = "America/Los_Angeles"; // UTC-7 (DST) / UTC-8

describe("formatDateOnly — #12: date-only values must not shift with workspace timezone", () => {
  it("shows the stored UTC calendar date regardless of timezone (no timeZone param at all)", () => {
    // A printed invoice date, stored as UTC midnight for July 6.
    expect(formatDateOnly("2026-07-06T00:00:00.000Z")).toBe("Jul 6, 2026");
  });

  it("reproduces the exact reported bug: formatWorkspaceDate (timezone-aware) rolls July 6 UTC-midnight back to July 5 in Pacific Time, formatDateOnly does not", () => {
    const value = "2026-07-06T00:00:00.000Z";
    expect(formatWorkspaceDate(value, PACIFIC)).toBe("Jul 5, 2026"); // the OLD, buggy path for this field
    expect(formatDateOnly(value)).toBe("Jul 6, 2026"); // the fix
  });

  it("is stable across different workspace timezones since it ignores timezone entirely", () => {
    // formatDateOnly takes no timeZone argument -- same output no matter
    // what workspace this invoice belongs to.
    expect(formatDateOnly("2026-01-15T00:00:00.000Z")).toBe("Jan 15, 2026");
  });

  it("returns an em-dash for null/undefined/invalid input", () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly(undefined)).toBe("—");
    expect(formatDateOnly("not-a-date")).toBe("—");
  });

  it("accepts a Date object directly, not just an ISO string", () => {
    expect(formatDateOnly(new Date("2026-12-25T00:00:00.000Z"))).toBe("Dec 25, 2026");
  });
});

describe("toDateOnlyInputValue — YYYY-MM-DD for <input type=\"date\">", () => {
  it("extracts the UTC calendar date, matching formatDateOnly", () => {
    expect(toDateOnlyInputValue("2026-07-06T00:00:00.000Z")).toBe("2026-07-06");
  });

  it("pads single-digit month/day", () => {
    expect(toDateOnlyInputValue("2026-01-05T00:00:00.000Z")).toBe("2026-01-05");
  });

  it("returns empty string for null/undefined/invalid input (not the em-dash formatDateOnly uses)", () => {
    expect(toDateOnlyInputValue(null)).toBe("");
    expect(toDateOnlyInputValue(undefined)).toBe("");
    expect(toDateOnlyInputValue("garbage")).toBe("");
  });

  it("round-trips through formatDateOnly's calendar date for any workspace timezone", () => {
    const value = "2026-07-06T00:00:00.000Z";
    const inputValue = toDateOnlyInputValue(value); // what the editable field shows
    const displayValue = formatDateOnly(value); // what the header shows
    expect(inputValue).toBe("2026-07-06");
    expect(displayValue).toBe("Jul 6, 2026");
    // Same calendar date in both -- this is the exact disagreement that was reported.
  });
});
