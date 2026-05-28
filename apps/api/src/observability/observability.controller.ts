import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { MetricsService } from "./metrics.service";

@Controller()
export class ObservabilityController {
  constructor(private readonly metrics: MetricsService) {}

  /** Prometheus scrape endpoint */
  @Public() @Get("metrics") @Header("Content-Type", "text/plain; version=0.0.4")
  async metricsEndpoint(@Res() res: Response) {
    res.send(await this.metrics.registry.metrics());
  }
}
