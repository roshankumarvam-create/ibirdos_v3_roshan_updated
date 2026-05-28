// =====================================================================
// apps/api/src/app.module.ts
// =====================================================================
// Wires: JWT, Redis, global guards (Tenant + Rbac + Csrf + RateLimit),
//        global interceptors (Audit), global filter (HttpException),
//        request-id middleware. All feature modules registered here.
// =====================================================================

import { MiddlewareConsumer, Module, NestModule, Global } from "@nestjs/common";
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { Redis } from "ioredis";

import { env } from "@ibirdos/config";

import { TenantGuard } from "./common/guards/tenant.guard";
import { RbacGuard } from "./common/guards/rbac.guard";
import { CsrfGuard } from "./common/guards/csrf.guard";
import { RateLimitGuard } from "./common/guards/rate-limit.guard";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { SecurityHeadersMiddleware } from "./common/middleware/security-headers.middleware";
import { PasswordService } from "./common/services/password.service";
import { SessionService } from "./common/services/session.service";

import { AuthModule } from "./auth/auth.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { UsersModule } from "./users/users.module";
import { HealthModule } from "./health/health.module";
import { UploadsModule } from "./uploads/uploads.module";
import { IngredientsModule } from "./ingredients/ingredients.module";
import { VendorsModule } from "./vendors/vendors.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { RecipesModule } from "./recipes/recipes.module";
import { InventoryModule } from "./inventory/inventory.module";
import { EventsModule } from "./events/events.module";
import { KitchenModule } from "./kitchen/kitchen.module";
import { YieldWasteModule } from "./yield-waste/yield-waste.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { CustomerOrderingModule } from "./customer-ordering/customer-ordering.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { VendorIntegrationsModule } from "./vendor-integrations/vendor-integrations.module";
import { BillingModule } from "./billing/billing.module";
import { InsightsModule } from "./insights/insights.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ObservabilityModule } from "./observability/observability.module";

export const REDIS_CLIENT = "REDIS_CLIENT";

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: env.AUTH_SECRET,
      signOptions: { algorithm: "HS256" },
    }),
    AuthModule, WorkspacesModule, UsersModule, HealthModule, UploadsModule,
    IngredientsModule, VendorsModule, InvoicesModule, RecipesModule, InventoryModule, EventsModule, KitchenModule, YieldWasteModule, AnalyticsModule, CustomerOrderingModule, RealtimeModule, VendorIntegrationsModule, BillingModule, InsightsModule, NotificationsModule, ObservabilityModule,
  ],
  providers: [
    PasswordService, SessionService,
    { provide: REDIS_CLIENT, useFactory: () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }) },
    // Guards run in declaration order. TenantGuard must come first so
    // every subsequent guard has access to req.ctx.
    { provide: APP_GUARD,  useClass: TenantGuard },
    { provide: APP_GUARD,  useClass: RbacGuard },
    { provide: APP_GUARD,  useClass: CsrfGuard },
    { provide: APP_GUARD,  useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
  exports: [PasswordService, SessionService, REDIS_CLIENT],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityHeadersMiddleware, RequestIdMiddleware).forRoutes("*");
  }
}
