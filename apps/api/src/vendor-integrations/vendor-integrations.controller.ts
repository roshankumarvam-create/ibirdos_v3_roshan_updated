import { Body, Controller, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { VendorIntegrationsService } from "./vendor-integrations.service";

const ImportSchema = z.object({ csv: z.string().min(10).max(2_000_000) });

@Controller("vendors/:id")
export class VendorIntegrationsController {
  constructor(private readonly svc: VendorIntegrationsService) {}

  @Post("catalog/import-csv") @RequirePermission("vendor.update")
  @Post("catalog/sync") @RequirePermission("vendor.update")
  sync(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return this.svc.syncVendorCatalog(ctx, id).then(ok);
  }

  importCsv(@CurrentCtx() ctx: TenantContext, @Param("id") id: string,
            @Body(new ZodValidationPipe(ImportSchema)) body: z.infer<typeof ImportSchema>) {
    return this.svc.importCsvCatalog(ctx, id, body.csv).then(ok);
  }
}
