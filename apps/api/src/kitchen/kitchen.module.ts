import { Module } from "@nestjs/common";
import { KitchenController } from "./kitchen.controller";
import { KitchenService } from "./kitchen.service";
import { InventoryModule } from "../inventory/inventory.module";
@Module({ imports: [InventoryModule], controllers: [KitchenController], providers: [KitchenService], exports: [KitchenService] })
export class KitchenModule {}
