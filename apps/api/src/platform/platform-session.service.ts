// =====================================================================
// apps/api/src/platform/platform-session.service.ts
// =====================================================================
// Mirrors common/services/session.service.ts exactly, but for
// PlatformUser/PlatformSession -- a completely separate table pair from
// the tenant User/Session system, so a browser can hold a tenant session
// and a platform session at the same time without collision.
//
// Cookie is intentionally distinct from env.AUTH_COOKIE_NAME. JWT payload
// carries typ: "platform" as defense-in-depth: even though tenant and
// platform sessions live in different tables (so a tenant JWT's hash
// simply won't match any platform_sessions row), this makes the two
// token kinds explicitly non-interchangeable at the payload level too.
// =====================================================================

import { Injectable } from "@nestjs/common";
import { Response, Request } from "express";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";

import { prisma } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("PlatformSessionService");

export const PLATFORM_AUTH_COOKIE_NAME = "ibirdos.platform_session";

export interface CreatePlatformSessionParams {
  platformUserId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class PlatformSessionService {
  constructor(private readonly jwt: JwtService) {}

  async create(res: Response, params: CreatePlatformSessionParams): Promise<void> {
    const expiresAt = new Date(
      Date.now() + env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000,
    );

    const session = await prisma.platformSession.create({
      data: {
        platformUserId: params.platformUserId,
        tokenHash: "pending",
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        expiresAt,
      },
    });

    const token = await this.jwt.signAsync(
      { sid: session.id, sub: params.platformUserId, typ: "platform" },
      { expiresIn: `${env.AUTH_SESSION_TTL_HOURS}h` },
    );
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await prisma.platformSession.update({
      where: { id: session.id },
      data: { tokenHash },
    });

    res.cookie(PLATFORM_AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      domain: env.AUTH_COOKIE_DOMAIN ?? undefined,
      expires: expiresAt,
    });

    log.info({ platformUserId: params.platformUserId, sessionId: session.id }, "platform session created");
  }

  async revoke(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.[PLATFORM_AUTH_COOKIE_NAME];
    if (token) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await prisma.platformSession
        .updateMany({
          where: { tokenHash, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        .catch((err) => log.warn({ err }, "platform session revoke db update failed"));
    }

    res.clearCookie(PLATFORM_AUTH_COOKIE_NAME, {
      path: "/",
      domain: env.AUTH_COOKIE_DOMAIN ?? undefined,
    });
  }

  async revokeAllForUser(platformUserId: string): Promise<void> {
    const result = await prisma.platformSession.updateMany({
      where: { platformUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    log.info({ platformUserId, revokedCount: result.count }, "all platform sessions revoked");
  }
}
