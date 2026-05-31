import { Body, Controller, Post } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { UploadsService } from "./uploads.service";

const PresignSchema = z.object({
  purpose: z.enum(["invoice", "recipe", "ingredient_photo", "recipe_photo", "recipe_video"]),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(127),
  sizeBytes: z.number().int().positive(),
});

@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post("presign")
  async presign(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(PresignSchema)) body: z.infer<typeof PresignSchema>,
  ) {
    return ok(await this.uploads.presignUpload(ctx, body));
  }
}
