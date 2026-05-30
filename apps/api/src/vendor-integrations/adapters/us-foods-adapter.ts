// =====================================================================
// US Foods MOXē adapter.
// =====================================================================
// US Foods exposes their catalog + ordering via MOXē Marketplace.
// API contract: REST with OAuth2 authorization-code flow per customer
// (each customer authorizes ONCE; we store a refresh token).
//
// Production config:
//   - USFOODS_API_BASE
//   - USFOODS_CLIENT_ID + USFOODS_CLIENT_SECRET
//   - Per-vendor refresh token stored in Vendor.integrationConfig (Json)
// =====================================================================
import { Injectable } from "@nestjs/common";
import type { VendorAdapter, VendorCatalogItem, PurchaseOrderLine, PurchaseOrderResult } from "./types";
import type { TenantContext } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("USFoodsAdapter");

@Injectable()
export class USFoodsVendorAdapter implements VendorAdapter {
  readonly type = "API" as const;

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    if (!env.USFOODS_API_BASE || !env.USFOODS_CLIENT_ID || !env.USFOODS_CLIENT_SECRET) {
      throw new Error("US Foods integration not configured");
    }
    const resp = await fetch(`${env.USFOODS_API_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: env.USFOODS_CLIENT_ID,
        client_secret: env.USFOODS_CLIENT_SECRET,
      }),
    });
    if (!resp.ok) throw new Error(`US Foods refresh failed: ${resp.status}`);
    const data = await resp.json() as { access_token: string };
    return data.access_token;
  }

  async fetchCatalog(ctx: TenantContext, vendorId: string): Promise<VendorCatalogItem[]> {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!vendor) throw new Error("Vendor not found");
    // For real production: vendor.integrationConfig?.refreshToken
    // (we don't have that field in current schema; for full prod add JSON config to Vendor)
    throw new Error("US Foods refresh token not configured for this vendor (add integrationConfig.refreshToken)");
  }

  async submitOrder(ctx: TenantContext, vendorId: string, lines: PurchaseOrderLine[]): Promise<PurchaseOrderResult> {
    throw new Error("US Foods order submission requires per-vendor refresh token configuration");
  }
}
