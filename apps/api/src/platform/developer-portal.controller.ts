import { Controller, Get, UseGuards } from "@nestjs/common";

import { ok } from "@ibirdos/types";

import { PlatformRoute } from "../common/decorators/platform-route.decorator";
import { RequirePlatformRole } from "../common/decorators/require-platform-role.decorator";
import { PlatformAuthGuard } from "../common/guards/platform-auth.guard";

import { PlatformAnalyticsService } from "./platform-analytics.service";

@Controller("platform/developer")
@PlatformRoute()
@UseGuards(PlatformAuthGuard)
@RequirePlatformRole("DEVELOPER")
export class DeveloperPortalController {
  constructor(private readonly analytics: PlatformAnalyticsService) {}

  @Get("analytics")
  async analyticsSummary() {
    return ok(await this.analytics.getAnalytics());
  }
}
