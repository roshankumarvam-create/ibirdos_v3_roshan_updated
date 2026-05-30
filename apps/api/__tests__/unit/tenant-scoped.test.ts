import { describe, it, expect } from "vitest";

describe("tenantScoped — query interception", () => {
  it("adds workspaceId to where clause on findMany", async () => {
    const calls: any[] = [];
    const fakeModel = {
      findMany: async (args: any) => { calls.push({ op: "findMany", args }); return []; },
      findUnique: async (args: any) => { calls.push({ op: "findUnique", args }); return null; },
      findFirst: async (args: any) => { calls.push({ op: "findFirst", args }); return null; },
      create: async (args: any) => { calls.push({ op: "create", args }); return args.data; },
      update: async (args: any) => { calls.push({ op: "update", args }); return args.data; },
      delete: async (args: any) => { calls.push({ op: "delete", args }); return {}; },
      count: async (args: any) => { calls.push({ op: "count", args }); return 0; },
    };
    const { tenantScoped } = await import("@ibirdos/db");
    const ctx = { workspaceId: "ws_A", userId: "user_A", role: "MANAGER" as const };
    const scoped = tenantScoped(fakeModel as any, ctx as any);
    await scoped.findMany({ where: { status: "ACTIVE" } });
    expect(calls[0].args.where.workspaceId).toBe("ws_A");
    await scoped.create({ data: { name: "thing" } });
    expect(calls[1].args.data.workspaceId).toBe("ws_A");
  });
});
