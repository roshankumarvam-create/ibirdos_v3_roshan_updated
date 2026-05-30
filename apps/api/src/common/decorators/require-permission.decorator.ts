import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@ibirdos/permissions";

export const REQUIRE_PERMISSION_KEY = "requirePermission";

/**
 * Restrict a route to callers whose role has ALL of the given
 * permissions. Preferred over @RequireRole.
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
