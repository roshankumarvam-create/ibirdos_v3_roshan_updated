// =====================================================================
// apps/api/src/platform/platform-analytics.service.ts
// =====================================================================
// Cross-tenant counts for the admin/developer portals. Deliberately uses
// the raw prisma client, not tenantScoped() -- this is the documented
// "admin/superadmin" exception in packages/db/src/index.ts. Shared by
// both AdminPortalController and DeveloperPortalController so the two
// portals can never drift on what a number means.
// =====================================================================

import { Injectable } from "@nestjs/common";
import { prisma } from "@ibirdos/db";

@Injectable()
export class PlatformAnalyticsService {
  async getAnalytics() {
    const [totalUsers, totalClients, totalPaidClients, totalAccounts, atRiskClients] =
      await Promise.all([
        // Distinct human users (soft-delete excluded)
        prisma.user.count({ where: { deletedAt: null } }),
        // "Clients" = workspaces
        prisma.workspace.count({ where: { deletedAt: null } }),
        // Paid = actively-billing subscription in good standing, not a trial.
        // PAST_DUE intentionally excluded -- see atRiskClients below.
        prisma.subscription.count({ where: { status: "ACTIVE", plan: { not: "TRIAL" } } }),
        // "Accounts" = active memberships, i.e. user-workspace pairs. A user
        // in 2 workspaces is 1 user but 2 accounts.
        prisma.membership.count({ where: { status: "ACTIVE" } }),
        // Bonus/optional: was paying, payment currently failing -- worth a
        // glance separate from the healthy "paid" headline number.
        prisma.subscription.count({ where: { status: "PAST_DUE" } }),
      ]);

    return { totalUsers, totalClients, totalPaidClients, totalAccounts, atRiskClients };
  }
}
