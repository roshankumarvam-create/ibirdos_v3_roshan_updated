// =====================================================================
// apps/api/src/common/services/zod-validation.pipe.ts
// =====================================================================
// Lets controllers validate request bodies with Zod schemas from
// @ibirdos/types directly:
//
//   @Post("login")
//   login(@Body(new ZodValidationPipe(LoginInputSchema)) body: LoginInput)
//
// The pipe throws a ZodError on failure, which HttpExceptionFilter
// converts to a 400 with field-level details.
// =====================================================================

import { PipeTransform, Injectable, ArgumentMetadata } from "@nestjs/common";
import { ZodSchema } from "zod";

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    // Only validate the request body — skip other params (ctx, query, param)
    // when this pipe is applied at method level via @UsePipes()
    if (metadata.type !== "body") return value as T;
    return this.schema.parse(value);
  }
}
