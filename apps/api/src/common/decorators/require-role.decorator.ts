import { SetMetadata } from "@nestjs/common";
import type { Role } from "@ibirdos/permissions";

export const REQUIRE_ROLE_KEY = "requireRole";

/**
 * Restrict a route to one or more roles. Use the more granular
 * @RequirePermission when possible — role checks become brittle
 * as the matrix evolves.
 */
export const RequireRole = (...roles: Role[]) =>
  SetMetadata(REQUIRE_ROLE_KEY, roles);
