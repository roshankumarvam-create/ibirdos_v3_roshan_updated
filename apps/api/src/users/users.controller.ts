// =====================================================================
// apps/api/src/users/users.controller.ts
// =====================================================================

import { Body, Controller, Get, Post } from "@nestjs/common";

import { ok, CreateUserInputSchema, type CreateUserInput } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";

import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @RequirePermission("user.create", "membership.create")
  async create(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(CreateUserInputSchema)) body: CreateUserInput,
  ) {
    const credentials = await this.users.createUser(ctx, body);
    // SECURITY NOTE: this is the ONE response in the entire API that
    // contains a plaintext credential. The web client must:
    //   - never log this body
    //   - present it in a "copy now, it won't be shown again" modal
    //   - clear it from memory after the modal is dismissed
    return ok({ credentials });
  }

  @Get()
  @RequirePermission("user.read")
  async list(@CurrentCtx() ctx: TenantContext) {
    const users = await this.users.listUsers(ctx);
    return ok({ users });
  }
}
