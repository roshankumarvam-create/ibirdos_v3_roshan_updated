import { SetMetadata } from "@nestjs/common";

export const REQUIRE_PLATFORM_ROLE_KEY = "requirePlatformRole";

/**
 * Restrict a platform route to exactly one PlatformRole. Checked by
 * PlatformAuthGuard, which 404s (not 403) on a mismatch -- an ADMIN
 * hitting a @RequirePlatformRole("DEVELOPER") route gets the same 404
 * as an unauthenticated tenant user.
 */
export const RequirePlatformRole = (role: "ADMIN" | "DEVELOPER") =>
  SetMetadata(REQUIRE_PLATFORM_ROLE_KEY, role);
