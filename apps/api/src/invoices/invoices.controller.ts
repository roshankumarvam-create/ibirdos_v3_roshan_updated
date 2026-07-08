import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
  UploadedFiles, UseInterceptors, BadRequestException, ServiceUnavailableException,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { ok } from "@ibirdos/types";
import type { TenantContext } from "@ibirdos/db";
import { extractInvoice } from "@ibirdos/ai";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { ZodValidationPipe } from "../common/services/zod-validation.pipe";
import { InvoicesService } from "./invoices.service";

const log = moduleLogger("InvoicesController");
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILES = 10;
type UploadedFileT = { buffer: Buffer; originalname: string; mimetype: string; size: number };

const CreateInvoiceSchema = z.object({
  uploadKey: z.string().min(1),
  uploadMimeType: z.string().min(1),
  uploadSizeBytes: z.number().int().positive(),
  vendorId: z.string().optional(),
});

const CreateManualInvoiceSchema = z.object({
  vendorId: z.string().optional(),
  invoiceNumber: z.string().max(80).optional(),
  invoiceDate: z.string().optional(),
});

const UpdateLineSchema = z.object({
  descriptionRaw: z.string().optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().optional(),
  unitPriceCents: z.number().int().optional(),
  extendedPriceCents: z.number().int().optional(),
  category: z.enum(["FOOD_INGREDIENT", "PACKAGING", "LABOR", "DELIVERY", "TAX", "DISCOUNT", "IGNORED"]).optional(),
  committedIngredientId: z.string().nullable().optional(),
  vendorItemCode: z.string().nullable().optional(),
  needsReview: z.boolean().optional(),
  excluded: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

const CreateLineSchema = z.object({
  descriptionRaw: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  unitPriceCents: z.number().int().nonnegative(),
  extendedPriceCents: z.number().int().nonnegative(),
  category: z.enum(["FOOD_INGREDIENT", "PACKAGING", "LABOR", "DELIVERY", "TAX", "DISCOUNT", "IGNORED"]).default("FOOD_INGREDIENT"),
  committedIngredientId: z.string().nullable().optional(),
  packSize: z.number().positive().nullable().optional(),
  packUnit: z.string().nullable().optional(),
  notes: z.string().max(500).optional(),
});

const UpdateInvoiceHeaderSchema = z.object({
  vendorId:      z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate:   z.string().nullable().optional(),
  dueDate:       z.string().nullable().optional(),
  subtotalCents: z.number().int().nonnegative().nullable().optional(),
  taxCents:      z.number().int().nonnegative().nullable().optional(),
  totalCents:    z.number().int().nonnegative().nullable().optional(),
});

const ImportCsvSchema = z.object({
  filename: z.string().min(1),
  contentBase64: z.string().min(1),
  vendorId: z.string().optional(),
});

const ListQuerySchema = z.object({
  status: z.string().optional(),
  vendorId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@Controller("invoices")
export class InvoicesController {
  constructor(private readonly svc: InvoicesService) {}

  @Get()
  @RequirePermission("invoice.read")
  async list(@CurrentCtx() ctx: TenantContext, @Query() q: any) {
    return ok(await this.svc.list(ctx, ListQuerySchema.parse(q)));
  }

  @Post()
  @RequirePermission("invoice.upload")
  async create(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(CreateInvoiceSchema)) body: z.infer<typeof CreateInvoiceSchema>,
  ) {
    return ok(await this.svc.create(ctx, body));
  }

  @Post("extract")
  @RequirePermission("invoice.upload")
  @UseInterceptors(FilesInterceptor("file", MAX_FILES, { limits: { fileSize: 25 * 1024 * 1024 } }))
  async extract(
    @CurrentCtx() ctx: TenantContext,
    @UploadedFiles() files: UploadedFileT[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException({ code: "validation_failed", message: "No file provided" });
    }
    if (files.length > MAX_FILES) {
      throw new BadRequestException({ code: "validation_failed", message: `Too many files. Max is ${MAX_FILES}.` });
    }
    const isPdf = (f: UploadedFileT) =>
      f.mimetype === "application/pdf" || f.originalname.toLowerCase().endsWith(".pdf");
    if (files.some(isPdf)) {
      throw new BadRequestException({
        code: "validation_failed",
        message: "Please upload PNG or JPEG images instead.",
      });
    }
    const isImage = (f: UploadedFileT) => {
      const ext = (f.originalname.split(".").pop() ?? "").toLowerCase();
      return IMAGE_MIMES.has(f.mimetype) || ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
    };
    if (!files.every(isImage)) {
      throw new BadRequestException({
        code: "validation_failed",
        message: "Unsupported file type. Please upload PNG or JPEG images only.",
      });
    }
    if (!env.OPENAI_API_KEY) {
      throw new ServiceUnavailableException({
        code: "service_unavailable",
        message: "Invoice extraction requires OPENAI_API_KEY.",
        hint: "Set OPENAI_API_KEY in your environment.",
      });
    }

    log.info(
      { workspaceId: ctx.workspaceId, filenames: files.map((f) => f.originalname), count: files.length },
      "invoice extract request",
    );

    const imageDataUrls = files.map(
      (f) => `data:${f.mimetype || "image/jpeg"};base64,${f.buffer.toString("base64")}`,
    );

    try {
      const result = await extractInvoice({ imageDataUrls, filename: files[0]!.originalname });
      return ok(result.data);
    } catch (err: any) {
      log.error({ err, filenames: files.map((f) => f.originalname) }, "invoice extraction failed");
      const isDev = process.env.NODE_ENV !== "production";
      throw new BadRequestException({
        code: "extraction_failed",
        message: isDev ? `Extraction error: ${err?.message ?? String(err)}` : "Extraction failed. Check server logs for details.",
      });
    }
  }

  @Post("manual")
  @RequirePermission("invoice.upload")
  async createManual(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(CreateManualInvoiceSchema)) body: z.infer<typeof CreateManualInvoiceSchema>,
  ) {
    return ok(await this.svc.createManual(ctx, body));
  }

  @Get(":id")
  @RequirePermission("invoice.read")
  async get(@CurrentCtx() ctx: TenantContext, @Param("id") id: string): Promise<any> {
    return ok(await this.svc.get(ctx, id));
  }

  @Patch(":id")
  @RequirePermission("invoice.review")
  async updateHeader(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateInvoiceHeaderSchema)) body: z.infer<typeof UpdateInvoiceHeaderSchema>,
  ): Promise<any> {
    return ok(await this.svc.updateHeader(ctx, id, body));
  }

  @Patch(":id/lines/:lineId")
  @RequirePermission("invoice.review")
  async updateLine(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body(new ZodValidationPipe(UpdateLineSchema)) body: z.infer<typeof UpdateLineSchema>,
  ): Promise<any> {
    return ok(await this.svc.updateLine(ctx, id, lineId, body));
  }

  @Post(":id/lines")
  @RequirePermission("invoice.review")
  async addLine(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(CreateLineSchema)) body: z.infer<typeof CreateLineSchema>,
  ): Promise<any> {
    return ok(await this.svc.addLine(ctx, id, body));
  }

  @Delete(":id/lines/:lineId")
  @RequirePermission("invoice.review")
  async deleteLine(
    @CurrentCtx() ctx: TenantContext,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
  ): Promise<any> {
    return ok(await this.svc.deleteLine(ctx, id, lineId));
  }

  @Post(":id/confirm")
  @RequirePermission("invoice.confirm")
  async confirm(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return ok(await this.svc.confirm(ctx, id));
  }

  @Post("import-csv")
  @RequirePermission("invoice.upload")
  async importCsv(
    @CurrentCtx() ctx: TenantContext,
    @Body(new ZodValidationPipe(ImportCsvSchema)) body: z.infer<typeof ImportCsvSchema>,
  ) {
    return ok(await this.svc.importCsv(ctx, body));
  }

  @Post(":id/retry")
  @RequirePermission("invoice.upload")
  async retry(@CurrentCtx() ctx: TenantContext, @Param("id") id: string) {
    return ok(await this.svc.retryExtraction(ctx, id));
  }
}
