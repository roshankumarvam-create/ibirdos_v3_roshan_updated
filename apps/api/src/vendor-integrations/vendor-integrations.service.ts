import { Injectable, BadRequestException } from "@nestjs/common";
import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

import { IngredientsService } from "../ingredients/ingredients.service";
import { CsvVendorAdapter } from "./adapters/csv-adapter";
import { ApiVendorAdapter } from "./adapters/api-adapter";
import { SyscoVendorAdapter } from "./adapters/sysco-adapter";
import { USFoodsVendorAdapter } from "./adapters/us-foods-adapter";
import { GfsVendorAdapter } from "./adapters/gfs-adapter";
import type { VendorAdapter, VendorCatalogItem } from "./adapters/types";

const log = moduleLogger("VendorIntegrationsService");

@Injectable()
export class VendorIntegrationsService {
  private adapters: Record<string, VendorAdapter>;

  constructor(
    private readonly csv: CsvVendorAdapter,
    private readonly apiAd: ApiVendorAdapter,
    private readonly sysco: SyscoVendorAdapter,
    private readonly usfoods: USFoodsVendorAdapter,
    private readonly gfs: GfsVendorAdapter,
    private readonly ingredients: IngredientsService,
  ) {
    this.adapters = { CSV: csv, API: apiAd, EDI: apiAd, EMAIL: apiAd, NONE: csv };
  }

  /** Resolve which adapter to use for a specific vendor by name */
  async resolveAdapter(vendorId: string): Promise<VendorAdapter> {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!v) throw new BadRequestException({ code: "not_found", message: "Vendor not found" });
    const name = v.name.toLowerCase();
    if (name.includes("sysco")) return this.sysco;
    if (name.includes("us foods") || name.includes("usfoods")) return this.usfoods;
    if (name.includes("gordon") || name.includes("gfs")) return this.gfs;
    return this.adapters[v.integrationType] ?? this.csv;
  }

  async syncVendorCatalog(ctx: TenantContext, vendorId: string) {
    const adapter = await this.resolveAdapter(vendorId);
    const items = await adapter.fetchCatalog(ctx, vendorId);
    log.info({ vendorId, items: items.length, adapterType: adapter.type }, "catalog fetched");

    let priceUpdated = 0, aliasAdded = 0;
    for (const item of items) {
      const matches = await this.ingredients.match(ctx, { text: item.description, vendorId });
      const top = matches[0];
      if (top && top.matchType === "exact" && top.ingredientId) {
        await this.ingredients.updatePrice(ctx, top.ingredientId, {
          pricePerCanonicalCents: item.pricePerUnitCents,
          source: "VENDOR_API", sourceRef: vendorId, vendorId,
        }).catch((err) => log.warn({ err: err.message }, "price update failed"));
        priceUpdated++;
      } else if (top && top.ingredientId) {
        await this.ingredients.addAlias(ctx, top.ingredientId, item.description, "VENDOR_CATALOG")
          .catch(() => {});
        aliasAdded++;
      }
    }

    await writeAudit(ctx, {
      action: "vendor.catalog_synced", entityType: "Vendor", entityId: vendorId,
      metadata: { adapterType: adapter.type, itemsFetched: items.length, priceUpdated, aliasAdded },
    });
    return { adapterType: adapter.type, itemsFetched: items.length, priceUpdated, aliasAdded };
  }

  async importCsvCatalog(ctx: TenantContext, vendorId: string, csv: string) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: vendorId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!vendor) throw new BadRequestException({ code: "not_found", message: "Vendor not found" });

    const items = this.csv.parseCsv(csv);
    log.info({ vendorId, itemCount: items.length }, "csv catalog parsed");

    let created = 0, priceUpdated = 0, aliasAdded = 0;
    for (const item of items) {
      // Find existing ingredient by matching the description against aliases
      const matches = await this.ingredients.match(ctx, { text: item.description, vendorId });
      const top = matches[0];

      if (top && top.matchType === "exact" && top.ingredientId) {
        // Update price for this vendor
        await this.ingredients.updatePrice(ctx, top.ingredientId, {
          pricePerCanonicalCents: item.pricePerUnitCents,
          source: "VENDOR_API", sourceRef: vendor.id, vendorId,
        }).catch((err) => log.warn({ err: err.message }, "price update failed"));
        priceUpdated++;
      } else {
        // Skip auto-create on imports — too risky. Just queue the alias
        // for chef to review.
        if (top && top.ingredientId) {
          await this.ingredients.addAlias(ctx, top.ingredientId, item.description, "VENDOR_CATALOG")
            .catch((err) => log.warn({ err: err.message }, "alias add failed"));
          aliasAdded++;
        }
      }
    }

    await writeAudit(ctx, {
      action: "vendor.catalog_imported", entityType: "Vendor", entityId: vendorId,
      metadata: { itemsParsed: items.length, priceUpdated, aliasAdded },
    });
    return { itemsParsed: items.length, priceUpdated, aliasAdded, unmatched: items.length - priceUpdated - aliasAdded };
  }
}
