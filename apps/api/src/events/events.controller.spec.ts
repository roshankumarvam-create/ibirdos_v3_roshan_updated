import { describe, it, expect } from "vitest";
import { isTodayOrFutureUTC, CreateEventSchema } from "./events.controller";

describe("isTodayOrFutureUTC — BUG 4: backdated events must be rejected", () => {
  it("rejects a clearly past date", () => {
    expect(isTodayOrFutureUTC("2020-06-10T12:00:00.000Z")).toBe(false);
  });

  it("accepts today's date", () => {
    const now = new Date();
    const todayNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
    expect(isTodayOrFutureUTC(todayNoon.toISOString())).toBe(true);
  });

  it("accepts a future date", () => {
    const future = new Date(Date.now() + 30 * 86400_000);
    expect(isTodayOrFutureUTC(future.toISOString())).toBe(true);
  });

  it("does not reject 'today' just because a few seconds passed since page load", () => {
    // Simulates picking "right now" then submitting a couple seconds later.
    const now = new Date(Date.now() - 5000);
    expect(isTodayOrFutureUTC(now.toISOString())).toBe(true);
  });
});

describe("CreateEventSchema — startsAt validation", () => {
  const base = { name: "Test event", startsAt: "", guestCount: 10 };

  it("fails validation for a backdated startsAt", () => {
    const result = CreateEventSchema.safeParse({ ...base, startsAt: "2020-01-01T00:00:00.000Z" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("startsAt"))).toBe(true);
    }
  });

  it("passes validation for a future startsAt", () => {
    const future = new Date(Date.now() + 7 * 86400_000).toISOString();
    const result = CreateEventSchema.safeParse({ ...base, startsAt: future });
    expect(result.success).toBe(true);
  });
});
