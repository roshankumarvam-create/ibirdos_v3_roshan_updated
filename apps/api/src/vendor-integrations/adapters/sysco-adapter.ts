// =====================================================================
// Sysco SHOP API adapter.
// =====================================================================
// Production reality: Sysco provides catalog + ordering via their
// SHOP API. Each Sysco-customer needs to authorize their account
// via OAuth; we then call REST endpoints with the bearer token.
//
// What this file provides:
//   - Full adapter shape implementing VendorAdapter
//   - OAuth client-credentials flow (with token caching)
//   - Catalog fetch with pagination
//   - Purchase order submission with proper request shape
//
// What it does NOT provide (and CANNOT, because we don't have keys):
//   - Real Sysco API endpoints (these are partner-confidential)
//
// To go live in production:
//   1. Acquire Sysco SHOP API partner credentials from your Sysco rep
//   2. Set SYSCO_API_BASE, SYSCO_CLIENT_ID, SYSCO_CLIENT_SECRET in env
//   3. Update SYSCO_API_BASE to the partner-provided URL
//   4. (Optional) override URL paths in this file if Sysco's docs
//      changed since this was written
// =====================================================================
import { Injectable } from "@nestjs/common";
import type { VendorAdapter, VendorCatalogItem, PurchaseOrderLine, PurchaseOrderResult } from "./types";
import type { TenantContext } from "@ibirdos/db";
import { env } from "@ibirdos/config";
import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("SyscoAdapter");

interface SyscoToken { accessToken: string; expiresAt: number; }

@Injectable()
export class SyscoVendorAdapter implements VendorAdapter {
  readonly type = "API" as const;
  private tokenCache = new Map<string, SyscoToken>();  // keyed by vendor account code

  /** Get a bearer token for a Sysco customer account (cached). */
  private async getToken(accountCode: string): Promise<string> {
    const cached = this.tokenCache.get(accountCode);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken;

    if (!env.SYSCO_API_BASE || !env.SYSCO_CLIENT_ID || !env.SYSCO_CLIENT_SECRET) {
      throw new Error("Sysco integration not configured (set SYSCO_API_BASE, SYSCO_CLIENT_ID, SYSCO_CLIENT_SECRET)");
    }

    const resp = await fetch(`${env.SYSCO_API_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.SYSCO_CLIENT_ID,
        client_secret: env.SYSCO_CLIENT_SECRET,
        scope: `account:${accountCode}`,
      }),
    });
    if (!resp.ok) throw new Error(`Sysco OAuth failed: ${resp.status} ${await resp.text()}`);
    const data = await resp.json() as { access_token: string; expires_in: number };
    const token: SyscoToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    this.tokenCache.set(accountCode, token);
    return token.accessToken;
  }

  async fetchCatalog(ctx: TenantContext, vendorId: string): Promise<VendorCatalogItem[]> {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!vendor) throw new Error("Vendor not found");
    if (!vendor.code) throw new Error("Sysco account code missing on vendor record");
    if (vendor.integrationType !== "API") throw new Error("Vendor is not configured for API integration");

    const token = await this.getToken(vendor.code);
    const items: VendorCatalogItem[] = [];
    let page = 1, hasMore = true;

    while (hasMore) {
      const resp = await fetch(`${env.SYSCO_API_BASE}/catalog/v1/items?page=${page}&pageSize=100`, {
        headers: { Authorization: `Bearer ${token}`, "X-Customer-Account": vendor.code },
      });
      if (!resp.ok) throw new Error(`Sysco catalog fetch failed: ${resp.status}`);
      const payload = await resp.json() as { items: any[]; pagination: { hasNext: boolean } };
      for (const it of payload.items) {
        items.push({
          sku: it.sku ?? it.itemNumber,
          description: it.description ?? it.name,
          unit: it.unitOfMeasure ?? "CS",
          packSize: it.packSize ? Number(it.packSize) : undefined,
          packUnit: it.packUnit,
          pricePerUnitCents: Math.round((it.unitPrice ?? 0) * 100),
          category: it.category,
        });
      }
      hasMore = payload.pagination?.hasNext === true;
      page++;
      if (page > 100) break; // safety cap
    }
    log.info({ vendorId, items: items.length }, "Sysco catalog fetched");
    return items;
  }

  async submitOrder(ctx: TenantContext, vendorId: string, lines: PurchaseOrderLine[]): Promise<PurchaseOrderResult> {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!vendor || !vendor.code) throw new Error("Vendor or account code missing");

    const token = await this.getToken(vendor.code);
    const resp = await fetch(`${env.SYSCO_API_BASE}/ordering/v1/purchase-orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Customer-Account": vendor.code,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accountCode: vendor.code,
        externalRef: `ibirdos-${Date.now()}`,
        lines: lines.map((l) => ({ sku: l.ingredientId, quantity: l.quantity, unit: l.unit })),
      }),
    });
    if (!resp.ok) throw new Error(`Sysco PO submit failed: ${resp.status}`);
    const data = await resp.json() as { orderId: string; estimatedDeliveryAt?: string };
    return {
      vendorOrderRef: data.orderId,
      estimatedDeliveryAt: data.estimatedDeliveryAt ? new Date(data.estimatedDeliveryAt) : undefined,
    };
  }
}
