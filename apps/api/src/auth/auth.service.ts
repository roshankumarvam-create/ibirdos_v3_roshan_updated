// =====================================================================
// apps/api/src/auth/auth.service.ts
// =====================================================================
// The login flow:
//   1. Brute-force check (Redis counter per username+IP)
//   2. Look up user by username
//   3. Verify password (constant-time)
//   4. Resolve active workspace (first ACTIVE membership)
//   5. Create session, set cookie
//   6. Audit log
//
// Same response for "wrong password" and "no such user" â€” never tell
// an attacker whether a username exists.
// =====================================================================

import {
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import { Request, Response } from "express";
import { Redis } from "ioredis";

import { prisma, writeAudit } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import type { LoginInput, SessionUser } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { PasswordService } from "../common/services/password.service";
import { SessionService } from "../common/services/session.service";
import { REDIS_CLIENT } from "../common/constants/tokens";

const log = moduleLogger("AuthService");

const LOGIN_FAIL_WINDOW_SEC = 15 * 60;     // count failures within 15 min
const LOGIN_FAIL_LOCKOUT_SEC = 30 * 60;    // lock out for 30 min after threshold
const LOGIN_FAIL_THRESHOLD = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async login(input: LoginInput, req: Request, res: Response): Promise<SessionUser> {
    const ip = this.clientIp(req);
    const ua = req.headers["user-agent"] ?? null;
    const lockKey = `auth:lock:${input.username}:${ip}`;
    const failKey = `auth:fail:${input.username}:${ip}`;

    // ---- Brute-force lockout ----
    if (await this.redis.get(lockKey)) {
      throw new HttpException(
        {
          code: "rate_limited",
          message: "Too many failed attempts. Try again in 30 minutes.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const denied = (): UnauthorizedException =>
      new UnauthorizedException({
        code: "unauthenticated",
        message: "Invalid username or password",
      });

    // ---- Look up user ----
    const user = await prisma.user.findUnique({
      where: { username: input.username },
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          include: {
            workspace: {
              select: { id: true, slug: true, status: true, deletedAt: true },
            },
          },
          orderBy: { createdAt: "asc" }, // first-joined workspace wins
        },
      },
    });

    if (!user || user.deletedAt) {
      // Run a dummy verify to keep timing constant for the "no user" case
      await this.passwords.verify(
        "$argon2id$v=19$m=65536,t=3,p=4$" +
          "ZHVtbXlzYWx0$ZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHU",
        input.password,
      );
      await this.recordFailure(failKey, lockKey);
      throw denied();
    }

    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      await this.recordFailure(failKey, lockKey);
      throw denied();
    }

    // ---- Pick active workspace ----
    const membership = user.memberships.find(
      (m) => m.workspace.status === "ACTIVE" && !m.workspace.deletedAt,
    );
    if (!membership) {
      throw new UnauthorizedException({
        code: "tenant_mismatch",
        message: "Your account has no active workspace",
      });
    }

    // ---- Create session ----
    await this.sessions.create(res, {
      userId: user.id,
      workspaceId: membership.workspaceId,
      ipAddress: ip,
      userAgent: typeof ua === "string" ? ua : undefined,
    });

    // ---- Opportunistic hash upgrade ----
    if (this.passwords.needsRehash(user.passwordHash)) {
      const newHash = await this.passwords.hash(input.password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      });
      log.info({ userId: user.id }, "password hash upgraded to new cost params");
    }

    // ---- Clear failure counter and update last-login ----
    await Promise.all([
      this.redis.del(failKey),
      prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    // ---- Audit ----
    await writeAudit(
      { userId: user.id, workspaceId: membership.workspaceId, role: membership.role },
      {
        action: "auth.login",
        entityType: "User",
        entityId: user.id,
        ipAddress: ip,
        userAgent: typeof ua === "string" ? ua : undefined,
      },
    );

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      workspaceId: membership.workspaceId,
      workspaceSlug: membership.workspace.slug,
      role: membership.role,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async logout(req: Request, res: Response): Promise<void> {
    await this.sessions.revoke(req, res);
  }

  /**
   * Whoami: returns the session user fresh from the DB (not from the
   * session payload) so role changes take effect on the next request,
   * not after re-login.
   */
  async me(userId: string, workspaceId: string): Promise<SessionUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { workspaceId, status: "ACTIVE" },
          include: { workspace: { select: { slug: true } } },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: "unauthenticated",
        message: "Account no longer exists",
      });
    }
    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException({
        code: "tenant_mismatch",
        message: "No active membership",
      });
    }
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      workspaceId,
      workspaceSlug: membership.workspace.slug,
      role: membership.role,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /**
   * First-login password change (and any subsequent self-service
   * password change). Verifies the current password, hashes the new
   * one with argon2id, clears mustChangePassword, and invalidates
   * every OTHER session so a leaked initial password can't ride along
   * after the user has rotated it. The current session stays valid so
   * the user isn't bounced back to the login screen.
   */
  async changePassword(
    ctx: TenantContext,
    userId: string,
    currentPassword: string,
    newPassword: string,
    req: Request,
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true, mustChangePassword: true },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: "unauthenticated",
        message: "Account no longer exists",
      });
    }

    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) {
      log.warn({ userId }, "change_password: current password mismatch");
      throw new HttpException(
        {
          ok: false,
          error: { code: "invalid_credentials", message: "Current password is incorrect" },
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const newHash = await this.passwords.hash(newPassword);
    const currentSessionId = await this.sessions.currentSessionId(req);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash, mustChangePassword: false },
      }),
      // Invalidate every other session for this user. The current
      // session is preserved so the password-change request itself
      // succeeds end-to-end.
      prisma.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    await writeAudit(ctx, {
      action: "user.password_changed",
      entityType: "User",
      entityId: userId,
      metadata: { wasFirstLogin: user.mustChangePassword },
    });

    log.info({ userId, wasFirstLogin: user.mustChangePassword }, "password changed");
  }



  private async recordFailure(failKey: string, lockKey: string): Promise<void> {
    const count = await this.redis.incr(failKey);
    if (count === 1) {
      await this.redis.expire(failKey, LOGIN_FAIL_WINDOW_SEC);
    }
    if (count >= LOGIN_FAIL_THRESHOLD) {
      await this.redis.setex(lockKey, LOGIN_FAIL_LOCKOUT_SEC, "1");
      log.warn({ failKey, count }, "login lockout triggered");
    }
  }

  private clientIp(req: Request): string {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string") return fwd.split(",")[0]!.trim();
    if (Array.isArray(fwd) && fwd[0]) return fwd[0].split(",")[0]!.trim();
    return req.ip ?? req.socket.remoteAddress ?? "unknown";
  }
}
