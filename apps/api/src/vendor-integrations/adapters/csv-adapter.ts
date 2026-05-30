// =====================================================================
// CSV adapter — chef uploads a vendor's catalog CSV, we parse it
// into VendorCatalogItem[]. Submit-order goes to email (Phase 16+).
// =====================================================================
import { Injectable } from "@nestjs/common";
import type { VendorAdapter, VendorCatalogItem, PurchaseOrderLine, PurchaseOrderResult } from "./types";
import type { TenantContext } from "@ibirdos/db";

@Injectable()
export class CsvVendorAdapter implements VendorAdapter {
  readonly type = "CSV" as const;

  /**
   * Parses a CSV string passed via the controller. Expected columns:
   * sku, description, unit, pack_size, pack_unit, price_cents, category
   */
  parseCsv(csv: string): VendorCatalogItem[] {
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
    const idx = (col: string) => header.indexOf(col);

    const items: VendorCatalogItem[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]!);
      if (cells.length < 4) continue;
      items.push({
        sku: cells[idx("sku")] ?? `row-${i}`,
        description: cells[idx("description")] ?? "",
        unit: cells[idx("unit")] ?? "each",
        packSize: idx("pack_size") >= 0 ? Number(cells[idx("pack_size")]) || undefined : undefined,
        packUnit: idx("pack_unit") >= 0 ? cells[idx("pack_unit")] : undefined,
        pricePerUnitCents: Math.round(Number(cells[idx("price_cents")] ?? "0")),
        category: idx("category") >= 0 ? cells[idx("category")] : undefined,
      });
    }
    return items;
  }

  async fetchCatalog(_ctx: TenantContext, _vendorId: string): Promise<VendorCatalogItem[]> {
    // CSV adapters don't auto-fetch; chef uploads via /vendors/:id/catalog/upload
    return [];
  }

  async submitOrder(_ctx: TenantContext, vendorId: string, lines: PurchaseOrderLine[]): Promise<PurchaseOrderResult> {
    // Stub: in production this generates a PDF/email summary and queues it
    return { vendorOrderRef: `csv-po-${vendorId.slice(0, 8)}-${Date.now()}` };
  }
}

// Lightweight CSV line parser (handles quoted commas)
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
    else if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) { cells.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
