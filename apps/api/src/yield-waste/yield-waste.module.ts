import { Module } from "@nestjs/common";
import { YieldWasteController } from "./yield-waste.controller";
import { YieldWasteService } from "./yield-waste.service";
import { InventoryModule } from "../inventory/inventory.module";
@Module({ imports: [InventoryModule], controllers: [YieldWasteController], providers: [YieldWasteService], exports: [YieldWasteService] })
export class YieldWasteModule {}
