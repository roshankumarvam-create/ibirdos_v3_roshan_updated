// =====================================================================
// apps/api/src/platform/platform-auth.controller.ts
// =====================================================================
// Login is @Public() (bypasses TenantGuard AND CsrfGuard, exactly like
// tenant /auth/login -- brute-force lockout substitutes for CSRF on a
// route with no prior session to protect). Everything else requires a
// valid platform session via PlatformAuthGuard, and carries @PlatformRoute()
// so TenantGuard doesn't also try to validate a tenant cookie that will
// never exist here -- CsrfGuard does NOT recognize @PlatformRoute(), so
// change-password stays CSRF-protected like every other mutating route.
// =====================================================================

import { Body, Controller, HttpCode, HttpStatus, Post, Get, Req, Res, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";
import { z } from "zod";

import { ok } from "@ibirdos/types";

import { Public } from "../common/decorators/public.decorator";
import { PlatformRoute } from "../common/decorators/platform-route.decorator";
import { RateLimit } from "../common/guards/rate-limit.guard";
import { PlatformAuthGuard } from "../common/guards/platform-auth.guard";
import { CurrentPlatformCtx } from "../common/decorators/current-platform-ctx.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import type { PlatformContext } from "../common/guards/platform-auth.guard";

import { PlatformAuthService } from "./platform-auth.service";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12).max(128),
    confirmPassword: z.string().min(12).max(128),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    path: ["newPassword"],
    message: "New password must differ from current password",
  });

@Controller("platform")
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @RateLimit({ limit: 10, windowSec: 60 })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.auth.login(body, req, res);
    return ok({ user });
  }

  @PlatformRoute()
  @UseGuards(PlatformAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req, res);
    return ok({ ok: true });
  }

  @PlatformRoute()
  @UseGuards(PlatformAuthGuard)
  @Get("me")
  async me(@CurrentPlatformCtx() ctx: PlatformContext) {
    return ok({ platformUserId: ctx.platformUserId, role: ctx.role });
  }

  @PlatformRoute()
  @UseGuards(PlatformAuthGuard)
  @RateLimit({ limit: 5, windowSec: 60 })
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body(new ZodValidationPipe(ChangePasswordSchema)) body: z.infer<typeof ChangePasswordSchema>,
    @CurrentPlatformCtx() ctx: PlatformContext,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(ctx.platformUserId, body.currentPassword, body.newPassword, req);
    return ok({ ok: true });
  }
}
