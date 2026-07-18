// =====================================================================
// apps/api/src/platform/platform-auth.service.ts
// =====================================================================
// Mirrors auth.service.ts's login/changePassword pattern (brute-force
// lockout, constant-time dummy verify, current-session-preserved
// invalidation) for platform_users. No workspace/membership resolution --
// platform users don't have one. No writeAudit() call: audit_logs.workspaceId
// is required (FK to Workspace), and platform actions aren't tied to a
// workspace -- logged via pino instead, same as PlatformSessionService.
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
import { createHash } from "crypto";

import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

import { PasswordService } from "../common/services/password.service";
import { PlatformSessionService, PLATFORM_AUTH_COOKIE_NAME } from "./platform-session.service";
import { REDIS_CLIENT } from "../common/constants/tokens";

const log = moduleLogger("PlatformAuthService");

const LOGIN_FAIL_WINDOW_SEC = 15 * 60;
const LOGIN_FAIL_LOCKOUT_SEC = 30 * 60;
const LOGIN_FAIL_THRESHOLD = 5;

export interface PlatformSessionUser {
  id: string;
  email: string;
  role: "ADMIN" | "DEVELOPER";
  mustChangePassword: boolean;
}

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly sessions: PlatformSessionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async login(
    input: { email: string; password: string },
    req: Request,
    res: Response,
  ): Promise<PlatformSessionUser> {
    const ip = this.clientIp(req);
    const ua = req.headers["user-agent"];
    const lockKey = `platform:auth:lock:${input.email}:${ip}`;
    const failKey = `platform:auth:fail:${input.email}:${ip}`;

    if (await this.redis.get(lockKey)) {
      throw new HttpException(
        { code: "rate_limited", message: "Too many failed attempts. Try again in 30 minutes." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const denied = () =>
      new UnauthorizedException({ code: "unauthenticated", message: "Invalid email or password" });

    const user = await prisma.platformUser.findUnique({ where: { email: input.email } });

    if (!user || user.deletedAt) {
      // Constant-time dummy verify so "no such account" times identically to "wrong password"
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

    await this.sessions.create(res, {
      platformUserId: user.id,
      ipAddress: ip,
      userAgent: typeof ua === "string" ? ua : undefined,
    });

    if (this.passwords.needsRehash(user.passwordHash)) {
      const newHash = await this.passwords.hash(input.password);
      await prisma.platformUser.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    }

    await Promise.all([
      this.redis.del(failKey),
      prisma.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    ]);

    log.info({ platformUserId: user.id, role: user.role }, "platform login");

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async logout(req: Request, res: Response): Promise<void> {
    await this.sessions.revoke(req, res);
  }

  async changePassword(
    platformUserId: string,
    currentPassword: string,
    newPassword: string,
    req: Request,
  ): Promise<void> {
    const user = await prisma.platformUser.findUnique({
      where: { id: platformUserId },
      select: { id: true, passwordHash: true, mustChangePassword: true },
    });
    if (!user) {
      throw new UnauthorizedException({ code: "unauthenticated", message: "Account no longer exists" });
    }

    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) {
      throw new HttpException(
        { ok: false, error: { code: "invalid_credentials", message: "Current password is incorrect" } },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const newHash = await this.passwords.hash(newPassword);
    const currentToken = req.cookies?.[PLATFORM_AUTH_COOKIE_NAME];
    const currentSession = currentToken
      ? await prisma.platformSession.findFirst({
          where: { tokenHash: createHash("sha256").update(currentToken).digest("hex") },
          select: { id: true },
        })
      : null;

    await prisma.$transaction([
      prisma.platformUser.update({
        where: { id: platformUserId },
        data: { passwordHash: newHash, mustChangePassword: false },
      }),
      prisma.platformSession.updateMany({
        where: {
          platformUserId,
          revokedAt: null,
          ...(currentSession ? { id: { not: currentSession.id } } : {}),
        },
        data: { revokedAt: new Date() },
      }),
    ]);

    log.info({ platformUserId, wasFirstLogin: user.mustChangePassword }, "platform password changed");
  }

  private async recordFailure(failKey: string, lockKey: string): Promise<void> {
    const count = await this.redis.incr(failKey);
    if (count === 1) await this.redis.expire(failKey, LOGIN_FAIL_WINDOW_SEC);
    if (count >= LOGIN_FAIL_THRESHOLD) await this.redis.setex(lockKey, LOGIN_FAIL_LOCKOUT_SEC, "1");
  }

  private clientIp(req: Request): string {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string") return fwd.split(",")[0]!.trim();
    if (Array.isArray(fwd) && fwd[0]) return fwd[0].split(",")[0]!.trim();
    return req.ip ?? req.socket.remoteAddress ?? "unknown";
  }
}
