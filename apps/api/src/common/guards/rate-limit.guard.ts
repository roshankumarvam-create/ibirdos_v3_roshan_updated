import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { Redis } from "ioredis";

import { moduleLogger } from "@ibirdos/logger";
import { REDIS_CLIENT } from "../../app.module";

const log = moduleLogger("RateLimitGuard");
const RATE_LIMIT_KEY = "rateLimit";

export interface RateLimitConfig {
  /** requests allowed per window */
  limit: number;
  /** window in seconds */
  windowSec: number;
}

/**
 * Override the default rate limit for a route or controller.
 * Default: 60 requests / 60s per (ip, route).
 */
export const RateLimit = (config: RateLimitConfig) =>
  SetMetadata(RATE_LIMIT_KEY, config);

const DEFAULT: RateLimitConfig = { limit: 60, windowSec: 60 };

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const cfg =
      this.reflector.getAllAndOverride<RateLimitConfig>(RATE_LIMIT_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? DEFAULT;

    const ip = this.clientIp(req);
    const route = `${req.method}:${req.route?.path ?? req.path}`;
    const key = `rl:${ip}:${route}`;

    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, cfg.windowSec);
      if (count > cfg.limit) {
        const ttl = await this.redis.ttl(key);
        throw new HttpException(
          {
            code: "rate_limited",
            message: `Too many requests. Retry in ${ttl}s.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis unavailable — fail OPEN (do not take down the platform)
      log.warn({ err: (err as Error).message }, "rate limit fail-open");
    }
    return true;
  }

  private clientIp(req: Request): string {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string") return fwd.split(",")[0]!.trim();
    return req.ip ?? "unknown";
  }
}
