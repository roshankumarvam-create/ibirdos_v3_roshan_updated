import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import type { TenantContext } from "@ibirdos/db";

/**
 * Injects the resolved TenantContext into controller methods.
 *
 *   @Get("me")
 *   me(@CurrentCtx() ctx: TenantContext) { ... }
 *
 * If this is called on a route that did not pass TenantGuard,
 * ctx will be undefined — which means the route is @Public() and
 * shouldn't be using this decorator anyway.
 */
export const CurrentCtx = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.ctx) {
      throw new Error(
        "@CurrentCtx() used on a route without TenantGuard. " +
          "Either remove @Public() or stop reading ctx here.",
      );
    }
    return req.ctx;
  },
);
