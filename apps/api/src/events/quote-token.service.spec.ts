import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake table simulating real Prisma/Postgres WHERE-equality
// semantics -- the point of these tests is to prove the LOOKUP LOGIC
// only ever matches by exact token equality, never by prefix/fuzzy/
// partial match, and never returns more than one event's data for one
// token.
interface FakeEventRow {
  id: string; workspaceId: string; name: string; serviceType: string;
  venueAddress: string | null; customerName: string | null; startsAt: Date;
  status: string; markupPct: { toString(): string }; laborTotalCents: number;
  quotedPriceCents: number | null; quotedTotalOverrideCents: number | null;
  quoteToken: string | null; deletedAt: Date | null;
}

let fakeTable: FakeEventRow[] = [];

const mockFindFirst = vi.fn(async ({ where, select }: any) => {
  const row = fakeTable.find((r) => {
    if (r.deletedAt !== null && where.deletedAt === null) return false;
    if (where.id !== undefined && r.id !== where.id) return false;
    if (where.workspaceId !== undefined && r.workspaceId !== where.workspaceId) return false;
    // Exact-equality match only -- this is the actual behavior under test.
    if (where.quoteToken !== undefined && r.quoteToken !== where.quoteToken) return false;
    return true;
  });
  if (!row) return null;
  const result: any = {};
  for (const key of Object.keys(select)) result[key] = (row as any)[key];
  return result;
});

const mockUpdate = vi.fn(async ({ where, data }: any) => {
  const row = fakeTable.find((r) => r.id === where.id);
  if (row) Object.assign(row, data);
  return row;
});

vi.mock("@ibirdos/db", () => ({
  prisma: {
    event: {
      findFirst: (args: any) => mockFindFirst(args),
      update: (args: any) => mockUpdate(args),
    },
  },
}));

import { getOrCreateQuoteToken, resolveEventByQuoteToken } from "./quote-token.service";

function makeEvent(overrides: Partial<FakeEventRow>): FakeEventRow {
  return {
    id: "ev1", workspaceId: "ws1", name: "Event", serviceType: "OTHER",
    venueAddress: null, customerName: null, startsAt: new Date(),
    status: "DRAFT", markupPct: { toString: () => "0" }, laborTotalCents: 0,
    quotedPriceCents: null, quotedTotalOverrideCents: null,
    quoteToken: null, deletedAt: null,
    ...overrides,
  };
}

describe("quote-token.service — BUG 5 security: a token can only ever resolve to the ONE event it was generated for", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeTable = [
      makeEvent({ id: "ev-A", workspaceId: "ws-A", name: "Smith Wedding", quoteToken: "a".repeat(64) }),
      makeEvent({ id: "ev-B", workspaceId: "ws-B", name: "Jones Birthday (different tenant entirely)", quoteToken: "b".repeat(64) }),
    ];
  });

  it("resolves token A to event A only, never event B's data", async () => {
    const result = await resolveEventByQuoteToken("a".repeat(64));
    expect(result?.id).toBe("ev-A");
    expect(result?.name).toBe("Smith Wedding");
    expect(result?.workspaceId).toBe("ws-A");
  });

  it("resolves token B to event B only, never event A's data", async () => {
    const result = await resolveEventByQuoteToken("b".repeat(64));
    expect(result?.id).toBe("ev-B");
    expect(result?.name).toBe("Jones Birthday (different tenant entirely)");
    expect(result?.workspaceId).toBe("ws-B");
  });

  it("a valid-FORMAT token that doesn't match any real event returns null, not another event's data", async () => {
    // Same length/charset as a real token, but not one that was ever
    // actually generated/stored for any event.
    const result = await resolveEventByQuoteToken("c".repeat(64));
    expect(result).toBeNull();
  });

  it("a token that is a strict PREFIX of a real token does not match (proves exact-equality, not LIKE/startsWith)", async () => {
    const result = await resolveEventByQuoteToken("a".repeat(32)); // half of event A's real token
    expect(result).toBeNull();
  });

  it("an empty or too-short token is rejected before ever querying the database", async () => {
    const result1 = await resolveEventByQuoteToken("");
    const result2 = await resolveEventByQuoteToken("short");
    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("getOrCreateQuoteToken generates a token scoped to the requesting workspace, and a mismatched workspaceId cannot mint/fetch another workspace's token", async () => {
    const token = await getOrCreateQuoteToken("ws-A", "ev-A");
    expect(token).not.toBeNull();
    expect(fakeTable.find((r) => r.id === "ev-A")!.quoteToken).toBe(token);

    // Wrong workspaceId for a real event id -- must not mint/return a token.
    const wrongWorkspace = await getOrCreateQuoteToken("ws-WRONG", "ev-B");
    expect(wrongWorkspace).toBeNull();
  });

  it("reuses an existing token rather than minting a new one on repeat calls", async () => {
    fakeTable[0]!.quoteToken = "existing-token-value".padEnd(64, "0");
    const token = await getOrCreateQuoteToken("ws-A", "ev-A");
    expect(token).toBe("existing-token-value".padEnd(64, "0"));
  });

  it("a soft-deleted event's token no longer resolves", async () => {
    fakeTable[0]!.deletedAt = new Date();
    const result = await resolveEventByQuoteToken("a".repeat(64));
    expect(result).toBeNull();
  });
});
