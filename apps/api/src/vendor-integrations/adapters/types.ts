// =====================================================================
// Vendor adapter interface — every integration implements this.
// Adding a new vendor partner = new adapter class, no other changes.
// =====================================================================

import type { TenantContext } from "@ibirdos/db";

export interface VendorCatalogItem {
  sku: string;
  description: string;
  unit: string;
  packSize?: number;
  packUnit?: string;
  pricePerUnitCents: number;
  category?: string;
}

export interface PurchaseOrderLine {
  ingredientId: string;
  quantity: number;
  unit: string;
}

export interface PurchaseOrderResult {
  vendorOrderRef: string;
  estimatedDeliveryAt?: Date;
}

/**
 * Every vendor integration implements this. Adapters are pure — no
 * NestJS decorators — so they can be instantiated by either the
 * sync controller or a scheduled BullMQ job.
 */
export interface VendorAdapter {
  readonly type: "NONE" | "API" | "EDI" | "EMAIL" | "CSV";

  /** Pull current catalog from the vendor. */
  fetchCatalog(ctx: TenantContext, vendorId: string): Promise<VendorCatalogItem[]>;

  /** Push a purchase order. Returns the vendor's order reference. */
  submitOrder(ctx: TenantContext, vendorId: string, lines: PurchaseOrderLine[]): Promise<PurchaseOrderResult>;
}
