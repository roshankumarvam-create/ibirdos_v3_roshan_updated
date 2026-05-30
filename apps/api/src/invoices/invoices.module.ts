import { Module } from "@nestjs/common";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { IngredientsModule } from "../ingredients/ingredients.module";
import { UploadsModule } from "../uploads/uploads.module";
import { InventoryModule } from "../inventory/inventory.module";

@Module({
  imports: [IngredientsModule, UploadsModule, InventoryModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
