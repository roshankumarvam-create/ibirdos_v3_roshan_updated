import { Module } from "@nestjs/common";
import { DailySalesController } from "./daily-sales.controller";
import { DailySalesService } from "./daily-sales.service";

@Module({
  controllers: [DailySalesController],
  providers: [DailySalesService],
  exports: [DailySalesService],
})
export class DailySalesModule {}
