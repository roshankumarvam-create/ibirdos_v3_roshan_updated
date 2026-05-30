// =====================================================================
// apps/api/src/users/users.service.ts
// =====================================================================
// The manager-creates-user flow per spec:
//   - manager picks username + role (no email required)
//   - system generates a secure random password
//   - returns { username, generatedPassword } ONCE to the caller
//   - mustChangePassword = true so the user is forced to set their
//     own password on first login
//
// The generated password is never logged, never stored in plaintext,
// never retrievable. If the manager loses it, they can issue a
// password reset (Phase 2.5 — not built yet) which regenerates it.
// =====================================================================

import {
  Injectable,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import type {
  CreateUserInput,
  CreatedUserCredentials,
} from "@ibirdos/types";

import { PasswordService } from "../common/services/password.service";

const log = moduleLogger("UsersService");

@Injectable()
export class UsersService {
  constructor(private readonly passwords: PasswordService) {}

  /**
   * Create a new user in the caller's workspace. Returns the
   * generated password — caller must show it ONCE to the manager
   * and then discard.
   */
  async createUser(
    ctx: TenantContext,
    input: CreateUserInput,
  ): Promise<CreatedUserCredentials> {
    // Per spec: only OWNER and MANAGER can create users.
    // RbacGuard enforces this at the route level via @RequirePermission,
    // but defense in depth — re-check here.
    if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") {
      throw new ForbiddenException({
        code: "forbidden",
        message: "Only owners and managers can create users",
      });
    }

    // Per spec: managers can create CHEF/STAFF/CUSTOMER. Only OWNER
    // can create MANAGER. OWNER cannot be created via this flow at all
    // (DTO already excludes OWNER, but defense in depth).
    if ((input.role as string) === "OWNER") {
      throw new ForbiddenException({
        code: "forbidden",
        message: "Owners are created only via workspace signup",
      });
    }
    if (input.role === "MANAGER" && ctx.role !== "OWNER") {
      throw new ForbiddenException({
        code: "forbidden",
        message: "Only owners can create managers",
      });
    }

    // Uniqueness check before hashing
    const existing = await prisma.user.findUnique({
      where: { username: input.username },
    });
    if (existing) {
      throw new ConflictException({
        code: "conflict",
        message: "Username already taken",
      });
    }

    const generatedPassword = this.passwords.generate(16);
    const passwordHash = await this.passwords.hash(generatedPassword);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: input.username,
          email: input.email ?? null,
          displayName: input.displayName ?? null,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await tx.membership.create({
        data: {
          workspaceId: ctx.workspaceId,
          userId: user.id,
          role: input.role,
          status: "ACTIVE",
          createdById: ctx.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: ctx.workspaceId,
          actorId: ctx.userId,
          action: "user.created",
          entityType: "User",
          entityId: user.id,
          metadata: { username: user.username, role: input.role },
        },
      });
      return user;
    });

    log.info(
      {
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        newUserId: result.id,
        role: input.role,
      },
      "user created by manager",
    );

    return {
      username: result.username,
      generatedPassword,
      role: input.role,
    };
  }

  /**
   * List users in the caller's workspace.
   */
  async listUsers(ctx: TenantContext) {
    const memberships = await prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            displayName: true,
            lastLoginAt: true,
            mustChangePassword: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return memberships.map((m) => ({
      ...m.user,
      role: m.role,
      membershipStatus: m.status,
    }));
  }
}
