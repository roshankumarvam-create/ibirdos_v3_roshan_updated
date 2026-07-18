import { Module } from "@nestjs/common";

import { PlatformSessionService } from "./platform-session.service";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformAnalyticsService } from "./platform-analytics.service";
import { PlatformAuthController } from "./platform-auth.controller";
import { AdminPortalController } from "./admin-portal.controller";
import { DeveloperPortalController } from "./developer-portal.controller";

@Module({
  controllers: [PlatformAuthController, AdminPortalController, DeveloperPortalController],
  providers: [PlatformSessionService, PlatformAuthService, PlatformAnalyticsService],
})
export class PlatformModule {}
