import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { RecipesModule } from "../recipes/recipes.module";
@Module({ imports: [RecipesModule], controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
