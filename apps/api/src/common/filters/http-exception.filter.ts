// =====================================================================
// apps/api/src/common/filters/http-exception.filter.ts
// =====================================================================
// All errors that exit a controller MUST pass through this filter.
// It converts any thrown error — known HttpException, Zod validation
// error, Prisma error, or unknown — into the standard envelope:
//
//   { data: null, error: { code, message, details? } }
//
// This keeps the client contract uniform across all routes and
// prevents accidental leakage of stack traces, Prisma errors, or
// internal codes to clients.
// =====================================================================

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@ibirdos/db";

import { fail, ErrorCodes } from "@ibirdos/types";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("HttpExceptionFilter");

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL_ERROR;
    let message: string = "Something went wrong";
    let details: unknown | undefined;

    // ---- Zod validation errors ----
    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCodes.VALIDATION_FAILED;
      message = "Request validation failed";
      details = exception.flatten();
    }
    // ---- NestJS HttpException (includes our UnauthorizedException etc.) ----
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as
        | string
        | { code?: string; message?: string; details?: unknown };

      if (typeof body === "string") {
        message = body;
      } else {
        code = body.code ?? this.codeForStatus(status);
        message = body.message ?? exception.message;
        details = body.details;
      }
    }
    // ---- Prisma errors — translate the common ones ----
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        status = HttpStatus.CONFLICT;
        code = ErrorCodes.CONFLICT;
        message = "Resource already exists";
        details = { target: exception.meta?.target };
      } else if (exception.code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        code = ErrorCodes.NOT_FOUND;
        message = "Resource not found";
      } else {
        log.error(
          { code: exception.code, meta: exception.meta, message: exception.message },
          "unhandled prisma error",
        );
      }
    }
    // ---- Truly unknown ----
    else {
      log.error(
        {
          err: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
          url: req.url,
        },
        "unhandled exception",
      );
    }

    // Never leak internal details on 5xx in production
    if (status >= 500 && process.env.NODE_ENV === "production") {
      details = undefined;
    }

    res.status(status).json(fail(code, message, details));
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case 400: return ErrorCodes.VALIDATION_FAILED;
      case 401: return ErrorCodes.UNAUTHENTICATED;
      case 403: return ErrorCodes.FORBIDDEN;
      case 404: return ErrorCodes.NOT_FOUND;
      case 409: return ErrorCodes.CONFLICT;
      case 429: return ErrorCodes.RATE_LIMITED;
      default:  return ErrorCodes.INTERNAL_ERROR;
    }
  }
}
