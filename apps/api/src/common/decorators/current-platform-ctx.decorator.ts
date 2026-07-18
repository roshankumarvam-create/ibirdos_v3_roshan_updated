import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import type { PlatformContext } from "../guards/platform-auth.guard";

/**
 * Injects the resolved PlatformContext into controller methods. Only valid
 * on routes behind @UseGuards(PlatformAuthGuard) -- if that guard didn't
 * run, req.platformCtx is undefined and this throws rather than silently
 * returning undefined.
 */
export const CurrentPlatformCtx = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.platformCtx) {
      throw new Error(
        "@CurrentPlatformCtx() used on a route without PlatformAuthGuard.",
      );
    }
    return req.platformCtx;
  },
);
