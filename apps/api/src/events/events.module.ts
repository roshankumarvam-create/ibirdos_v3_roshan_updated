import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { RecipesModule } from "../recipes/recipes.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { InventoryModule } from "../inventory/inventory.module";
@Module({ imports: [RecipesModule, NotificationsModule, InventoryModule], controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
