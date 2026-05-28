// =====================================================================
// API adapter — generic skeleton for partners exposing REST/GraphQL
// catalog endpoints (e.g., Sysco SHOP, US Foods MOXē). Concrete
// partners subclass this in Phase 16+ as real contracts arrive.
// =====================================================================
import { Injectable } from "@nestjs/common";
import type { VendorAdapter, VendorCatalogItem, PurchaseOrderLine, PurchaseOrderResult } from "./types";
import type { TenantContext } from "@ibirdos/db";

@Injectable()
export class ApiVendorAdapter implements VendorAdapter {
  readonly type = "API" as const;

  async fetchCatalog(_ctx: TenantContext, _vendorId: string): Promise<VendorCatalogItem[]> {
    // TODO: per-partner subclass implements OAuth + catalog fetch
    throw new Error("API adapter not yet configured for this vendor");
  }

  async submitOrder(_ctx: TenantContext, vendorId: string, _lines: PurchaseOrderLine[]): Promise<PurchaseOrderResult> {
    throw new Error("API adapter submit-order not yet configured for this vendor");
  }
}
