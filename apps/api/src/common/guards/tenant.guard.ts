// =====================================================================
// apps/api/src/common/guards/tenant.guard.ts
// =====================================================================
// THE most important security control in the system.
//
// Runs on every request that isn't marked @Public(). Extracts the
// session cookie, validates it, resolves the workspace context, and
// attaches { userId, workspaceId, role } to request.ctx.
//
// Failure modes (all → 401):
//   - no cookie
//   - JWT signature invalid
//   - JWT expired
//   - no Session row with matching tokenHash
//   - Session expired or revoked
//   - User soft-deleted
//   - Membership missing or suspended
//
// After this guard passes, downstream code can trust request.ctx
// absolutely. There is no other way to enter the controller layer.
// =====================================================================

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { createHash } from "crypto";
import { JwtService } from "@nestjs/jwt";

import { prisma, TenantContext } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

const log = moduleLogger("TenantGuard");

declare module "express" {
  interface Request {
    ctx?: TenantContext;
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ---- @Public() routes bypass ----
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[env.AUTH_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException({
        code: "unauthenticated",
        message: "No session cookie",
      });
    }

    // ---- 1. JWT signature + exp ----
    let payload: { sid: string; sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch (err) {
      log.debug({ err: (err as Error).message }, "jwt verify failed");
      throw new UnauthorizedException({
        code: "unauthenticated",
        message: "Invalid session",
      });
    }

    // ---- 2. Session row exists and is live ----
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            deletedAt: true,
            memberships: {
              where: { status: "ACTIVE" },
              select: {
                workspaceId: true,
                role: true,
                workspace: { select: { status: true, deletedAt: true } },
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new UnauthorizedException({
        code: "unauthenticated",
        message: "Session not found",
      });
    }
    if (session.revokedAt) {
      throw new UnauthorizedException({
        code: "unauthenticated",
        message: "Session revoked",
      });
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: "unauthenticated",
        message: "Session expired",
      });
    }
    if (session.user.deletedAt) {
      throw new UnauthorizedException({
        code: "unauthenticated",
        message: "Account no longer exists",
      });
    }

    // ---- 3. Membership for session's workspace ----
    const membership = session.user.memberships.find(
      (m) => m.workspaceId === session.workspaceId,
    );
    if (!membership) {
      throw new UnauthorizedException({
        code: "tenant_mismatch",
        message: "No active membership for this workspace",
      });
    }
    if (membership.workspace.status !== "ACTIVE" || membership.workspace.deletedAt) {
      throw new UnauthorizedException({
        code: "tenant_mismatch",
        message: "Workspace is not active",
      });
    }

    // ---- 4. Attach context ----
    req.ctx = {
      userId: session.userId,
      workspaceId: session.workspaceId,
      role: membership.role,
    };

    return true;
  }
}
