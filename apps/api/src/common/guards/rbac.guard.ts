// =====================================================================
// apps/api/src/common/guards/rbac.guard.ts
// =====================================================================
// Runs AFTER TenantGuard. Reads @RequireRole / @RequirePermission
// metadata off the route handler and class, and consults the central
// permission matrix in @ibirdos/permissions.
//
// If the route specifies neither requirement, this guard passes
// through. Default-open here is fine because TenantGuard has already
// enforced authentication and workspace context. The controller author
// is responsible for declaring what authorization is needed.
//
// Code review rule: every non-@Public() controller route MUST carry
// either @RequireRole or @RequirePermission. The lint plugin in
// Phase 4 enforces this mechanically.
// =====================================================================

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";

import { can, canAny, type Permission, type Role } from "@ibirdos/permissions";
import { moduleLogger } from "@ibirdos/logger";

import { REQUIRE_ROLE_KEY } from "../decorators/require-role.decorator";
import { REQUIRE_PERMISSION_KEY } from "../decorators/require-permission.decorator";

const log = moduleLogger("RbacGuard");

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = req.ctx;

    // TenantGuard always runs first; if ctx is missing, the route is
    // @Public() and RbacGuard is a no-op.
    if (!ctx) return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const requiredPermissions = this.reflector.getAllAndOverride<
      Permission[] | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    // ---- Role check ----
    if (requiredRoles && requiredRoles.length > 0) {
      if (!requiredRoles.includes(ctx.role)) {
        log.warn(
          {
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
            role: ctx.role,
            requiredRoles,
            route: req.url,
          },
          "rbac role denied",
        );
        throw new ForbiddenException({
          code: "forbidden",
          message: "Insufficient role for this action",
        });
      }
    }

    // ---- Permission check (more granular than role) ----
    if (requiredPermissions && requiredPermissions.length > 0) {
      const allowed = requiredPermissions.every((p) => can(ctx.role, p));
      if (!allowed) {
        log.warn(
          {
            userId: ctx.userId,
            workspaceId: ctx.workspaceId,
            role: ctx.role,
            requiredPermissions,
            route: req.url,
          },
          "rbac permission denied",
        );
        throw new ForbiddenException({
          code: "forbidden",
          message: "Insufficient permission for this action",
        });
      }
    }

    return true;
  }
}
