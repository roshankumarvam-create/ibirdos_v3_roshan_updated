// =====================================================================
// Records request count + duration into Prometheus on every request.
// =====================================================================

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import { httpRequestsTotal, httpDurationSeconds } from "./metrics.controller";

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();
    return next.handle().pipe(
      tap({
        next:  () => this.record(req, res, start),
        error: () => this.record(req, res, start),
      }),
    );
  }
  private record(req: Request, res: Response, start: bigint) {
    const route = (req.route?.path as string | undefined) ?? req.path.replace(/\/[a-f0-9]{20,}/g, "/:id");
    const labels = { method: req.method, route, status: String(res.statusCode) };
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestsTotal.inc(labels);
    httpDurationSeconds.observe(labels, seconds);
  }
}
