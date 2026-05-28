// =====================================================================
// apps/api/src/common/services/session.service.ts
// =====================================================================
// Creates and revokes sessions.
//
// Token shape: signed JWT carrying { sid, sub } where sid is the
//   Session.id and sub is the User.id. We sign so we can verify
//   structure cheaply before hitting the DB; the DB lookup is the
//   authoritative check.
//
// Storage: we store sha256(jwt) as Session.tokenHash. The plain JWT
//   never leaves the cookie. A DB leak therefore exposes hashes of
//   tokens, not the tokens themselves.
//
// Cookie attributes: HttpOnly, Secure (prod), SameSite=Lax, signed.
//   SameSite=Lax mitigates most CSRF; Phase 4 adds double-submit
//   cookies for the cases SameSite doesn't cover.
// =====================================================================

import { Injectable } from "@nestjs/common";
import { Response, Request } from "express";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "crypto";

import { prisma } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("SessionService");

export interface CreateSessionParams {
  userId: string;
  workspaceId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SessionService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * Create a new session row, sign a JWT, set the HttpOnly cookie.
   * Returns nothing — the cookie is the side effect.
   */
  async create(res: Response, params: CreateSessionParams): Promise<void> {
    const expiresAt = new Date(
      Date.now() + env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000,
    );

    // Create row first so we have an id to embed in the JWT
    const session = await prisma.session.create({
      data: {
        userId: params.userId,
        workspaceId: params.workspaceId,
        tokenHash: "pending", // updated below in same transaction-equivalent
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        expiresAt,
      },
    });

    const token = await this.jwt.signAsync(
      { sid: session.id, sub: params.userId },
      { expiresIn: `${env.AUTH_SESSION_TTL_HOURS}h` },
    );
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await prisma.session.update({
      where: { id: session.id },
      data: { tokenHash },
    });

    res.cookie(env.AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      domain: env.AUTH_COOKIE_DOMAIN ?? undefined,
      expires: expiresAt,
    });

    log.info(
      { userId: params.userId, workspaceId: params.workspaceId, sessionId: session.id },
      "session created",
    );
  }

  /**
   * Revoke the current session (logout). Clears the cookie and
   * marks the Session row revoked.
   */
  async revoke(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.[env.AUTH_COOKIE_NAME];
    if (token) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await prisma.session
        .updateMany({
          where: { tokenHash, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        .catch((err) => {
          // Don't fail logout if the DB write fails — clearing the
          // cookie still effectively logs the user out client-side.
          log.warn({ err }, "session revoke db update failed");
        });
    }

    res.clearCookie(env.AUTH_COOKIE_NAME, {
      path: "/",
      domain: env.AUTH_COOKIE_DOMAIN ?? undefined,
    });
  }

  /**
   * Revoke every active session for a user. Used after a password
   * change, when an admin disables an account, or for "log me out
   * everywhere" actions.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    const result = await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    log.info({ userId, revokedCount: result.count }, "all user sessions revoked");
  }
}
