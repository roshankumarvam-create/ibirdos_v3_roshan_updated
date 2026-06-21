import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockMembershipFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockMembershipUpdate = vi.fn();
const mockAuditLogCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@ibirdos/db", () => ({
  prisma: {
    membership: { findUnique: (...a: any[]) => mockMembershipFindUnique(...a) },
    $transaction: (...a: any[]) => mockTransaction(...a),
  },
  writeAudit: vi.fn(),
}));

vi.mock("ioredis", () => ({ Redis: class {} }));
vi.mock("../common/constants/tokens", () => ({ REDIS_CLIENT: "REDIS_CLIENT" }));

import { UsersService } from "./users.service";
import { NotFoundException, ForbiddenException } from "@nestjs/common";

const mockPasswords = { generate: vi.fn(), hash: vi.fn(), compare: vi.fn() };
const ctx = { workspaceId: "ws1", userId: "actor1", role: "OWNER" as const };

function makeMembership(overrides: object = {}) {
  return {
    role: "CHEF",
    status: "ACTIVE",
    user: { id: "u1", username: "jdoe" },
    ...overrides,
  };
}

describe("UsersService.updateUser — PATCH /api/v1/users/:id", () => {
  let svc: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new UsersService(mockPasswords as any);
    // Default: $transaction calls its callback with a mock tx
    mockTransaction.mockImplementation(async (fn: any) => {
      const tx = {
        user: { update: mockUserUpdate },
        membership: { update: mockMembershipUpdate },
        auditLog: { create: mockAuditLogCreate },
      };
      await fn(tx);
    });
    // Default getUser call inside updateUser returns the membership
    mockMembershipFindUnique.mockResolvedValue(makeMembership());
    mockUserUpdate.mockResolvedValue({});
    mockMembershipUpdate.mockResolvedValue({});
    mockAuditLogCreate.mockResolvedValue({});
  });

  it("throws 404 when user is not a member of the workspace", async () => {
    mockMembershipFindUnique.mockResolvedValueOnce(null);
    await expect(svc.updateUser(ctx, "u-missing", {})).rejects.toThrow(NotFoundException);
  });

  it("throws 403 when trying to modify the OWNER account", async () => {
    mockMembershipFindUnique.mockResolvedValueOnce(makeMembership({ role: "OWNER" }));
    await expect(svc.updateUser(ctx, "u1", { displayName: "New" })).rejects.toThrow(ForbiddenException);
  });

  it("throws 403 when a non-OWNER tries to promote to MANAGER", async () => {
    const managerCtx = { ...ctx, role: "MANAGER" as const };
    await expect(svc.updateUser(managerCtx, "u1", { role: "MANAGER" })).rejects.toThrow(ForbiddenException);
  });

  it("updates displayName on the user record", async () => {
    // First call: find membership for update check; second: find membership in getUser
    mockMembershipFindUnique
      .mockResolvedValueOnce(makeMembership())
      .mockResolvedValueOnce(makeMembership({ user: { id: "u1", username: "jdoe", displayName: "Jane" } }));

    await svc.updateUser(ctx, "u1", { displayName: "Jane" });

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: "Jane" }) }),
    );
  });

  it("updates membership status when disabled=true", async () => {
    mockMembershipFindUnique
      .mockResolvedValueOnce(makeMembership())
      .mockResolvedValueOnce(makeMembership({ status: "SUSPENDED" }));

    await svc.updateUser(ctx, "u1", { disabled: true });

    expect(mockMembershipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUSPENDED" }) }),
    );
  });

  it("updates role when caller is OWNER", async () => {
    mockMembershipFindUnique
      .mockResolvedValueOnce(makeMembership())
      .mockResolvedValueOnce(makeMembership({ role: "MANAGER" }));

    await svc.updateUser(ctx, "u1", { role: "MANAGER" });

    expect(mockMembershipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "MANAGER" }) }),
    );
  });
});
