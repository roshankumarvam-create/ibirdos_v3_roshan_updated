import { SetMetadata } from "@nestjs/common";

export const IS_PLATFORM_ROUTE_KEY = "isPlatformRoute";

/**
 * Marks a route as belonging to the platform admin/developer portal --
 * authenticated by PlatformAuthGuard against platform_users/platform_sessions,
 * NOT the tenant User/Membership/Session system. TenantGuard bypasses these
 * routes (mirroring its @Public() bypass) since it has nothing to check here;
 * unlike @Public(), CsrfGuard does NOT recognize this decorator, so mutating
 * platform routes (login excluded) still require the normal CSRF token.
 */
export const PlatformRoute = () => SetMetadata(IS_PLATFORM_ROUTE_KEY, true);
