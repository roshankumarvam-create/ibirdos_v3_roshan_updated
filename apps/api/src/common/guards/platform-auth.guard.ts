// =====================================================================
// apps/api/src/common/guards/platform-auth.guard.ts
// =====================================================================
// Gates the platform admin/developer portal. Applied via @UseGuards() at
// the controller level on AdminPortalController / DeveloperPortalController
// / PlatformAuthController -- NOT a global APP_GUARD, since it only
// applies to platform routes (which TenantGuard already bypasses via
// @PlatformRoute()).
//
// Every failure mode -- missing cookie, invalid/expired JWT, no matching
// session row, revoked, expired, wrong role for this controller -- throws
// NotFoundException (404), never 401/403. The portal's existence must not
// be revealed to anyone who isn't already a valid, correctly-roled
// platform user. This is also how ADMIN and DEVELOPER stay invisible to
// each other: hitting the other role's controller 404s exactly like a
// route that doesn't exist.
// =====================================================================

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { createHash } from "crypto";
import { JwtService } from "@nestjs/jwt";

import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

import { PLATFORM_AUTH_COOKIE_NAME } from "../../platform/platform-session.service";
import { REQUIRE_PLATFORM_ROLE_KEY } from "../decorators/require-platform-role.decorator";

const log = moduleLogger("PlatformAuthGuard");

export interface PlatformContext {
  platformUserId: string;
  role: "ADMIN" | "DEVELOPER";
}

declare module "express" {
  interface Request {
    platformCtx?: PlatformContext;
  }
}

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[PLATFORM_AUTH_COOKIE_NAME];
    if (!token) throw new NotFoundException();

    let payload: { sid: string; sub: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch (err) {
      log.debug({ err: (err as Error).message }, "platform jwt verify failed");
      throw new NotFoundException();
    }
    if (payload.typ !== "platform") throw new NotFoundException();

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await prisma.platformSession.findUnique({
      where: { tokenHash },
      include: {
        platformUser: { select: { id: true, role: true, deletedAt: true } },
      },
    });
    if (!session) throw new NotFoundException();
    if (session.revokedAt) throw new NotFoundException();
    if (session.expiresAt < new Date()) throw new NotFoundException();
    if (session.platformUser.deletedAt) throw new NotFoundException();

    const requiredRole = this.reflector.getAllAndOverride<"ADMIN" | "DEVELOPER" | undefined>(
      REQUIRE_PLATFORM_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRole && session.platformUser.role !== requiredRole) {
      // Wrong portal for this platform user (e.g. ADMIN hitting developer routes).
      // Same 404 as "not a platform user at all" -- mutual invisibility by design.
      throw new NotFoundException();
    }

    req.platformCtx = {
      platformUserId: session.platformUser.id,
      role: session.platformUser.role,
    };
    return true;
  }
}
