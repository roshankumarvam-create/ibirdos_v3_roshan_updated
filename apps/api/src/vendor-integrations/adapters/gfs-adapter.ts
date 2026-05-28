// =====================================================================
// Gordon Food Service adapter (CSV-only fallback).
// =====================================================================
// GFS doesn't expose a public REST catalog API at the time of writing.
// Customers receive a weekly CSV catalog drop via SFTP or email. This
// adapter inherits the CSV adapter behavior; admins upload the file
// via the existing /vendors/:id/catalog/import-csv endpoint.
// =====================================================================
import { Injectable } from "@nestjs/common";
import { CsvVendorAdapter } from "./csv-adapter";

@Injectable()
export class GfsVendorAdapter extends CsvVendorAdapter {
  readonly type = "CSV" as const;
}
