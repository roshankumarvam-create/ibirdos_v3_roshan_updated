import {
  Controller, Post, UploadedFile, UseInterceptors,
  BadRequestException, ServiceUnavailableException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ok } from "@ibirdos/types";
import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { extractRecipeFromImage, parseRowsToRecipe } from "@ibirdos/ai";
import { env } from "@ibirdos/config";
import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import * as XLSX from "xlsx";

const log = moduleLogger("RecipesExtractController");

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const EXCEL_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

@Controller("recipes")
export class RecipesExtractController {
  @Post("extract")
  @RequirePermission("recipe.create")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  async extract(
    @CurrentCtx() ctx: TenantContext,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    if (!file) throw new BadRequestException({ code: "validation_failed", message: "No file provided" });

    const mime = file.mimetype;
    const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
    const buf = file.buffer;

    log.info({ workspaceId: ctx.workspaceId, filename: file.originalname, mime, size: buf.length }, "recipe extract request");

    let result;

    try {
      if (IMAGE_MIMES.has(mime) || ["jpg","jpeg","png","webp","gif"].includes(ext)) {
        if (!env.OPENAI_API_KEY) {
          throw new ServiceUnavailableException({
            code: "service_unavailable",
            message: "Image extraction requires OPENAI_API_KEY. Excel and CSV imports still work.",
            hint: "Set OPENAI_API_KEY in your environment, or upload an Excel/CSV file instead.",
          });
        }
        const b64 = buf.toString("base64");
        const dataUrl = `data:${mime || "image/jpeg"};base64,${b64}`;
        result = await extractRecipeFromImage({ imageUrl: dataUrl, filename: file.originalname });

      } else if (mime === "application/pdf" || ext === "pdf") {
        throw new ServiceUnavailableException({
          code: "service_unavailable",
          message: "PDF extraction requires server-side conversion.",
          hint: "Upload as JPEG/PNG screenshot, or export as Excel/CSV.",
        });

      } else if (EXCEL_MIMES.has(mime) || ["xlsx","xls"].includes(ext)) {
        let workbook: XLSX.WorkBook;
        try {
          workbook = XLSX.read(buf, { type: "buffer" });
        } catch (xlsxErr: any) {
          log.error({ err: xlsxErr, filename: file.originalname }, "XLSX parse error");
          throw new BadRequestException({
            code: "validation_failed",
            message: `Could not parse Excel file: ${xlsxErr?.message ?? "unknown error"}`,
            hint: "Make sure the file is a valid .xlsx or .xls file and not password-protected.",
          });
        }

        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new BadRequestException({
            code: "validation_failed",
            message: "Workbook is empty — no sheets found.",
            hint: "Make sure the file has at least one sheet with data.",
          });
        }

        let rows: (string | number | boolean | null | undefined)[][];
        try {
          rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]!, { header: 1, defval: "" }) as (string | number | boolean | null | undefined)[][];
        } catch (sheetErr: any) {
          log.error({ err: sheetErr, sheetName }, "sheet_to_json error");
          throw new BadRequestException({
            code: "validation_failed",
            message: `Could not read sheet "${sheetName}": ${sheetErr?.message ?? "unknown error"}`,
            hint: "Try exporting to CSV and uploading that instead.",
          });
        }

        result = { ...parseRowsToRecipe(rows), source: "excel" as const };

      } else if (mime === "text/csv" || ext === "csv") {
        let text: string;
        try {
          text = buf.toString("utf8");
        } catch (decodeErr: any) {
          throw new BadRequestException({
            code: "validation_failed",
            message: "Could not decode CSV file as UTF-8.",
            hint: "Make sure the file is saved as UTF-8 CSV.",
          });
        }

        const rows = text.split(/\r?\n/).map((line: string) =>
          line.split(",").map((cell: string) => cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"')),
        );
        result = { ...parseRowsToRecipe(rows), source: "csv" as const };

      } else {
        throw new BadRequestException({
          code: "validation_failed",
          message: `Unsupported file type: ${mime || ext || "unknown"}.`,
          hint: "Supported formats: JPEG, PNG, XLSX, XLS, CSV.",
        });
      }
    } catch (err: any) {
      // Re-throw NestJS HTTP exceptions as-is
      if (err?.status >= 400) throw err;

      // Unexpected errors — log full stack, return safe message
      log.error({ err, filename: file.originalname, mime }, "unexpected extraction error");
      const isDev = process.env.NODE_ENV !== "production";
      throw new BadRequestException({
        code: "extraction_failed",
        message: isDev ? `Extraction error: ${err?.message ?? String(err)}` : "Extraction failed. Check server logs for details.",
        hint: isDev ? err?.stack?.split("\n")[1] ?? undefined : "Contact your administrator if this continues.",
      });
    }

    // Warn if parser found no useful data
    if (result.data.ingredientLines.length === 0 && result.fieldsFound === 0) {
      log.warn({ filename: file.originalname }, "extraction returned no data");
      return ok({
        ...result,
        warning: "Could not detect recipe columns. Check column headers: expected 'Ingredient' (or 'Item', 'Description'), 'Qty' (or 'Quantity'), 'Unit'. Review and fill in manually.",
        data: { ...result.data, ingredientLines: [] },
      });
    }

    // Fuzzy-match ingredient names against workspace ingredients
    const enriched = await Promise.all(
      result.data.ingredientLines.map(async (line) => {
        const match = await findIngredient(ctx.workspaceId, line.name);
        return { ...line, ingredientId: match?.id ?? null, matchedName: match?.name ?? null };
      }),
    );

    return ok({
      ...result,
      data: { ...result.data, ingredientLines: enriched },
    });
  }
}

async function findIngredient(workspaceId: string, name: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;

  // Exact match on ingredient name (case-insensitive)
  const exact = await prisma.ingredient.findFirst({
    where: { workspaceId, deletedAt: null, name: { equals: normalized, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (exact) return exact;

  // Alias match
  const alias = await prisma.ingredientAlias.findFirst({
    where: { workspaceId, text: normalized },
    include: { ingredient: { select: { id: true, name: true, deletedAt: true } } },
  });
  if (alias && !alias.ingredient.deletedAt) return alias.ingredient;

  // Starts-with prefix match (simple fuzzy) — try multiple lengths for resilience
  const prefixLen = Math.min(6, normalized.length);
  if (prefixLen >= 3) {
    const prefix = await prisma.ingredient.findFirst({
      where: {
        workspaceId, deletedAt: null,
        name: { startsWith: normalized.slice(0, prefixLen), mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    if (prefix) return prefix;
  }

  return null;
}
