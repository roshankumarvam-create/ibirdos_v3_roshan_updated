import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "@ibirdos/logger";

declare module "express" {
  interface Request {
    id?: string;
    log?: ReturnType<typeof logger.child>;
  }
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id =
      (req.headers["x-request-id"] as string | undefined)?.slice(0, 64) ||
      randomUUID();
    req.id = id;
    req.log = logger.child({ requestId: id });
    res.setHeader("X-Request-Id", id);
    next();
  }
}
