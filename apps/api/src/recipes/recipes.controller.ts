import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";

import { RecipesService } from "./recipes.service";

const LineSchema = z.object({
  ingredientId:    z.string().min(1),
  externalCode:    z.string().optional(),
  quantity:        z.number().positive(),
  unit:            z.string().min(1).max(32),
  yieldPctOverride: z.number().min(0).max(200).nullable().optional(),
  percentUtilized: z.number().min(1).max(200).optional(),
  weightOz:        z.number().positive().optional(),
  notes:           z.string().max(500).optional(),
});

const CreateRecipeSchema = z.object({
  name:                 z.string().min(1).max(200),
  authorName:           z.string().max(120).optional(),
  category:             z.string().max(80).optional(),
  description:          z.string().max(2000).optional(),
  status:               z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  prepTimeMin:          z.number().int().nonnegative().optional(),
  prepTimeMinutes:      z.number().int().nonnegative().optional(),
  cookTimeMin:          z.number().int().nonnegative().optional(),
  cookTimeMinutes:      z.number().int().nonnegative().optional(),
  portionsYielded:      z.number().int().positive().optional(),
  totalPortions:        z.number().int().positive().optional(),
  portionWeightG:       z.number().positive().optional(),
  portionVolumeMl:      z.number().positive().optional(),
  totalYieldCanonical:  z.number().positive().optional(),
  totalYieldDimension:  z.enum(["MASS", "VOLUME", "COUNT"]).optional(),
  salePriceCents:       z.number().int().nonnegative().optional(),
  actualSellPriceCents: z.number().int().nonnegative().optional(),
  goalFoodCostPct:      z.number().min(0).max(100).optional(),
  targetMarginPct:      z.number().min(0).max(100).optional(),
  paperCostCents:       z.number().int().nonnegative().optional(),
  autoReprice:          z.boolean().optional(),
  photoUrl:             z.string().url().optional(),
  prepPhotoUrl:         z.string().url().optional(),
  finalPhotoUrl:        z.string().url().optional(),
  videoUrl:             z.string().url().optional(),
  instructionsMd:       z.string().max(20000).optional(),
  procedure:            z.string().max(20000).optional(),
  notes:                z.string().max(2000).optional(),
  ingredients:          z.array(LineSchema).optional(),
  ingredientLines:      z.array(LineSchema).optional(),
});

const UpdateRecipeSchema = CreateRecipeSchema.partial().omit({ ingredients: true }).extend({
  photoUrl:      z.union([z.string().url(), z.null()]).optional(),
  prepPhotoUrl:  z.union([z.string().url(), z.null()]).optional(),
  finalPhotoUrl: z.union([z.string().url(), z.null()]).optional(),
  videoUrl:      z.union([z.string().url(), z.null()]).optional(),
  authorName:    z.union([z.string().max(120), z.null()]).optional(),
  category:      z.union([z.string().max(80), z.null()]).optional(),
  notes:         z.union([z.string().max(2000), z.null()]).optional(),
  procedure:     z.union([z.string().max(20000), z.null()]).optional(),
  instructionsMd: z.union([z.string().max(20000), z.null()]).optional(),
});
const ListQuerySchema = z.object({
  search: z.string().optional(), category: z.string().optional(),
  status: z.string().optional(), cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller("recipes")
export class RecipesController {
  constructor(private readonly svc: RecipesService) {}

  @Get() @RequirePermission("recipe.read")
  list(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return this.svc.list(ctx, ListQuerySchema.parse(q)).then(ok);
  }

  @Post() @RequirePermission("recipe.create")
  create(@CurrentCtx() ctx: TenantContext, @Body(new ZodValidationPipe(CreateRecipeSchema)) body: any) {
    return this.svc.create(ctx, body).then(ok);
  }

  @Get(":id") @RequirePermission("recipe.read")
  get(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return this.svc.get(ctx, id).then(ok);
  }

  @Patch(":id") @RequirePermission("recipe.update")
  update(@CurrentCtx() ctx: TenantContext, @Param("id") id: string,
         @Body(new ZodValidationPipe(UpdateRecipeSchema)) body: any) {
    return this.svc.update(ctx, id, body).then(ok);
  }

  @Delete(":id") @RequirePermission("recipe.update")
  delete(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return this.svc.delete(ctx, id).then(() => ok(null));
  }

  @Post(":id/ingredients") @RequirePermission("recipe.update")
  addIngredient(@CurrentCtx() ctx: TenantContext, @Param("id") id: string,
                @Body(new ZodValidationPipe(LineSchema)) body: any) {
    return this.svc.addIngredient(ctx, id, body).then(ok);
  }

  @Delete(":id/ingredients/:linkId") @RequirePermission("recipe.update")
  removeIngredient(@CurrentCtx() ctx: TenantContext, @Param("id") id: string,
                   @Param("linkId") linkId: string) {
    return this.svc.removeIngredient(ctx, id, linkId).then(ok);
  }

  @Post(":id/recost") @RequirePermission("recipe.read")
  recost(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return this.svc.recost(ctx, id, "manual_recost").then((r) => ok({
      totalCents: Number(r.totalMicrocents) / 1000,
      perPortionCents: r.perPortionMicrocents != null ? Number(r.perPortionMicrocents) / 1000 : null,
      marginPct: r.marginPct, staleness: r.staleness, error: r.computeError,
      lines: r.lines.map((l) => ({
        ...l,
        lineCostMicrocents: l.lineCostMicrocents != null ? l.lineCostMicrocents.toString() : null,
      })),
    }));
  }
}
