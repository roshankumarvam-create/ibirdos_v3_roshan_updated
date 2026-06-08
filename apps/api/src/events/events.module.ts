import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { RecipesModule } from "../recipes/recipes.module";
import { NotificationsModule } from "../notifications/notifications.module";
@Module({ imports: [RecipesModule, NotificationsModule], controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
