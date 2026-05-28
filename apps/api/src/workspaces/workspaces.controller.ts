// =====================================================================
// apps/api/src/workspaces/workspaces.controller.ts
// =====================================================================

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  NotFoundException,
} from "@nestjs/common";
import { Request, Response } from "express";

import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { Public } from "../common/decorators/public.decorator";
import { RateLimit } from "../common/guards/rate-limit.guard";
import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";

import {
  WorkspacesService,
  SignupInputSchema,
  type SignupInput,
} from "./workspaces.service";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Public()
  @RateLimit({ limit: 5, windowSec: 60 })
  @Post("signup")
  @HttpCode(HttpStatus.CREATED)
  async signup(
    @Body(new ZodValidationPipe(SignupInputSchema)) body: SignupInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.workspaces.signup(body, req, res);
    return ok(result);
  }

  @Get(":slug")
  async findBySlug(
    @Param("slug") slug: string,
    @CurrentCtx() ctx: TenantContext,
  ) {
    const ws = await this.workspaces.findBySlug(slug, ctx.workspaceId);
    if (!ws) throw new NotFoundException({ code: "not_found", message: "Workspace not found" });
    return ok({ workspace: ws });
  }
}
