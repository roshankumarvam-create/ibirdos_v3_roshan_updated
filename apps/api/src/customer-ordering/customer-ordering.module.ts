import { Module } from "@nestjs/common";
import { CustomerOrderingController } from "./customer-ordering.controller";
import { CustomerOrderingService } from "./customer-ordering.service";
import { EventsModule } from "../events/events.module";
@Module({ imports: [EventsModule], controllers: [CustomerOrderingController], providers: [CustomerOrderingService] })
export class CustomerOrderingModule {}
