import { Module } from "@nestjs/common";
import { VendorIntegrationsController } from "./vendor-integrations.controller";
import { VendorIntegrationsService } from "./vendor-integrations.service";
import { CsvVendorAdapter } from "./adapters/csv-adapter";
import { ApiVendorAdapter } from "./adapters/api-adapter";
import { SyscoVendorAdapter } from "./adapters/sysco-adapter";
import { USFoodsVendorAdapter } from "./adapters/us-foods-adapter";
import { GfsVendorAdapter } from "./adapters/gfs-adapter";
import { IngredientsModule } from "../ingredients/ingredients.module";

@Module({
  imports: [IngredientsModule],
  controllers: [VendorIntegrationsController],
  providers: [VendorIntegrationsService, CsvVendorAdapter, ApiVendorAdapter, SyscoVendorAdapter, USFoodsVendorAdapter, GfsVendorAdapter],
  exports: [VendorIntegrationsService],
})
export class VendorIntegrationsModule {}
