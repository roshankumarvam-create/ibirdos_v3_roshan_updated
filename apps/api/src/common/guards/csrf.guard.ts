import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";

import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_COOKIE = "ibirdos.csrf";
const CSRF_HEADER = "x-csrf-token";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    // Safe methods bypass
    if (SAFE_METHODS.has(req.method)) return true;

    // Public endpoints (login, signup) bypass — they don't have a session
    // yet to attack. Login uses rate limiting + brute-force lockout
    // instead of CSRF.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.headers[CSRF_HEADER];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException({
        code: "forbidden",
        message: "CSRF token missing or invalid",
      });
    }
    return true;
  }
}
