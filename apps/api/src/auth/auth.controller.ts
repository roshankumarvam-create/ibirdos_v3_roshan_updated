// =====================================================================
// apps/api/src/auth/auth.controller.ts
// =====================================================================

import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";

import { LoginInputSchema, ok, type LoginInput } from "@ibirdos/types";

import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/guards/rate-limit.guard";
import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import type { TenantContext } from "@ibirdos/db";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";

import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @RateLimit({ limit: 10, windowSec: 60 })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginInputSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.login(body, req, res);
    return ok({ user });
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req, res);
    return ok({ ok: true });
  }

  @Get("me")
  async me(@CurrentCtx() ctx: TenantContext) {
    const user = await this.auth.me(ctx.userId, ctx.workspaceId);
    return ok({ user });
  }
}
