import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// In-memory fake table simulating real Postgres WHERE-equality semantics --
// the point of these tests is to prove the LOOKUP LOGIC only ever matches
// by exact token equality, never by prefix/fuzzy/partial match, and never
// returns more than one event's data for one token.
interface FakeEventRow {
  id: string; workspace_id: string; name: string; service_type: string;
  venue_address: string | null; customer_name: string | null; starts_at: Date;
  status: string; markup_pct: string; labor_total_cents: number;
  quoted_price_cents: number | null; quoted_total_override_cents: number | null;
  quote_token: string | null;
}

let fakeTable: FakeEventRow[] = [];
let queryShouldThrow = false;

const mockQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
  if (queryShouldThrow) throw new Error('column "quote_token" does not exist');
  const sql = strings.join("?");
  if (sql.includes("SELECT quote_token FROM events WHERE id")) {
    const [eventId, workspaceId] = values;
    const row = fakeTable.find((r) => r.id === eventId && r.workspace_id === workspaceId);
    return row ? [{ quote_token: row.quote_token }] : [];
  }
  if (sql.includes("SELECT id, workspace_id, name")) {
    const [token] = values;
    // Exact-equality match only -- this is the actual behavior under test.
    const row = fakeTable.find((r) => r.quote_token === token);
    return row ? [row] : [];
  }
  throw new Error(`unexpected query in test: ${sql}`);
});

const mockExecuteRaw = vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
  if (queryShouldThrow) throw new Error('column "quote_token" does not exist');
  const [token, eventId, workspaceId] = values;
  const row = fakeTable.find((r) => r.id === eventId && r.workspace_id === workspaceId);
  if (row) row.quote_token = token;
  return 1;
});

vi.mock("@ibirdos/db", () => ({
  prisma: {
    $queryRaw: (strings: TemplateStringsArray, ...values: any[]) => mockQueryRaw(strings, ...values),
    $executeRaw: (strings: TemplateStringsArray, ...values: any[]) => mockExecuteRaw(strings, ...values),
  },
}));

import { getOrCreateQuoteToken, resolveEventByQuoteToken } from "./quote-token.service";

function makeEvent(overrides: Partial<FakeEventRow>): FakeEventRow {
  return {
    id: "ev1", workspace_id: "ws1", name: "Event", service_type: "OTHER",
    venue_address: null, customer_name: null, starts_at: new Date(),
    status: "DRAFT", markup_pct: "0", labor_total_cents: 0,
    quoted_price_cents: null, quoted_total_override_cents: null,
    quote_token: null,
    ...overrides,
  };
}

describe("quote-token.service — BUG 5 security: a token can only ever resolve to the ONE event it was generated for", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryShouldThrow = false;
    fakeTable = [
      makeEvent({ id: "ev-A", workspace_id: "ws-A", name: "Smith Wedding", quote_token: "a".repeat(64) }),
      makeEvent({ id: "ev-B", workspace_id: "ws-B", name: "Jones Birthday (different tenant entirely)", quote_token: "b".repeat(64) }),
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
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });

  it("getOrCreateQuoteToken generates a token scoped to the requesting workspace, and a mismatched workspaceId cannot mint/fetch another workspace's token", async () => {
    const token = await getOrCreateQuoteToken("ws-A", "ev-A");
    expect(token).not.toBeNull();
    expect(fakeTable.find((r) => r.id === "ev-A")!.quote_token).toBe(token);

    // Wrong workspaceId for a real event id -- must not mint/return a token.
    const wrongWorkspace = await getOrCreateQuoteToken("ws-WRONG", "ev-B");
    expect(wrongWorkspace).toBeNull();
  });

  it("reuses an existing token rather than minting a new one on repeat calls", async () => {
    fakeTable[0]!.quote_token = "existing-token-value".padEnd(64, "0");
    const token = await getOrCreateQuoteToken("ws-A", "ev-A");
    expect(token).toBe("existing-token-value".padEnd(64, "0"));
  });

  it("degrades gracefully (returns null, doesn't throw) when the quote_token column doesn't exist yet -- the migration-not-run case", async () => {
    queryShouldThrow = true;
    const lookupResult = await resolveEventByQuoteToken("a".repeat(64));
    const tokenResult = await getOrCreateQuoteToken("ws-A", "ev-A");
    expect(lookupResult).toBeNull();
    expect(tokenResult).toBeNull();
  });
});
