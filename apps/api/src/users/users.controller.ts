// =====================================================================
// apps/api/src/users/users.controller.ts
// =====================================================================

import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";

import { ok, CreateUserInputSchema, RoleSchema, type CreateUserInput } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";

import { UsersService } from "./users.service";

const UpdateUserInputSchema = z.object({
  displayName: z.string().max(80).optional(),
  email:       z.string().email().optional(),
  role:        RoleSchema.exclude(["OWNER"]).optional(),
  disabled:    z.boolean().optional(),
});
type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

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

  @Get(":id")
  @RequirePermission("user.read")
  async getOne(@CurrentCtx() ctx: TenantContext, @Param("id") userId: string) {
    const user = await this.users.getUser(ctx, userId);
    return ok({ user });
  }

  @Patch(":id")
  @RequirePermission("user.update")
  async update(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") userId: string,
    @Body(new ZodValidationPipe(UpdateUserInputSchema)) body: UpdateUserInput,
  ) {
    const user = await this.users.updateUser(ctx, userId, body);
    return ok({ user });
  }

  @Post(":id/reset-password")
  @RequirePermission("user.reset_password")
  async resetPassword(@CurrentCtx() ctx: TenantContext, @Param("id") userId: string) {
    const credentials = await this.users.resetPassword(ctx, userId);
    return ok({ credentials });
  }
}
