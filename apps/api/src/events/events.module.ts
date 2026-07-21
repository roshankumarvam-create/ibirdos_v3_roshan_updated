import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { PublicQuoteController } from "./public-quote.controller";
import { EventsService } from "./events.service";
import { RecipesModule } from "../recipes/recipes.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { InventoryModule } from "../inventory/inventory.module";
@Module({
  imports: [RecipesModule, NotificationsModule, InventoryModule],
  controllers: [EventsController, PublicQuoteController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
