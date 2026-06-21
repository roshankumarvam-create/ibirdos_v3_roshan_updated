import {
  Controller, Post, UploadedFile, UseInterceptors,
  BadRequestException, ServiceUnavailableException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ok } from "@ibirdos/types";
import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import {
  extractRecipeFromImage,
  parseRowsToRecipe,
  type RecipeVisionResult,
  type RecipeExtractResult,
  type ExtractedRecipe,
} from "@ibirdos/ai";
import { env } from "@ibirdos/config";
import { CurrentCtx } from "../common/decorators/current-ctx.decorator";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import * as XLSX from "xlsx";
import { parseXLSX, parseCSV, type SpreadsheetParseResult } from "./recipe-spreadsheet-parser";

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

    let visionResult: RecipeVisionResult | undefined;
    let csvResult: RecipeExtractResult | undefined;

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
        visionResult = await extractRecipeFromImage({ imageUrl: dataUrl, filename: file.originalname });

      } else if (mime === "application/pdf" || ext === "pdf") {
        throw new ServiceUnavailableException({
          code: "service_unavailable",
          message: "PDF extraction requires server-side conversion.",
          hint: "Upload as JPEG/PNG screenshot, or export as Excel/CSV.",
        });

      } else if (EXCEL_MIMES.has(mime) || ["xlsx","xls"].includes(ext)) {
        // Try deterministic parser first; fall back to legacy parseRowsToRecipe only if it produces nothing.
        const parsed = parseXLSX(buf);
        const adapted = parsedToExtractResult(parsed, "excel");
        if (adapted) {
          log.info({ filename: file.originalname, recipes: parsed.recipes.length }, "deterministic XLSX parse succeeded");
          csvResult = adapted;
        } else {
          // Fallback: legacy parser
          log.warn({ filename: file.originalname, unparsed: parsed.unparsed }, "deterministic XLSX parse found no recipes — falling back to legacy parser");
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
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]!, { header: 1, defval: "" }) as (string | number | boolean | null | undefined)[][];
          csvResult = { ...parseRowsToRecipe(rows), source: "excel" as const };
        }

      } else if (mime === "text/csv" || ext === "csv") {
        // Try deterministic parser first; fall back to legacy parseRowsToRecipe only if it produces nothing.
        const parsed = parseCSV(buf);
        const adapted = parsedToExtractResult(parsed, "csv");
        if (adapted) {
          log.info({ filename: file.originalname, recipes: parsed.recipes.length }, "deterministic CSV parse succeeded");
          csvResult = adapted;
        } else {
          log.warn({ filename: file.originalname, unparsed: parsed.unparsed }, "deterministic CSV parse found no recipes — falling back to legacy parser");
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
          csvResult = { ...parseRowsToRecipe(rows), source: "csv" as const };
        }

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

      log.error({ err, filename: file.originalname, mime }, "unexpected extraction error");
      const isDev = process.env.NODE_ENV !== "production";
      throw new BadRequestException({
        code: "extraction_failed",
        message: isDev ? `Extraction error: ${err?.message ?? String(err)}` : "Extraction failed. Check server logs for details.",
        hint: isDev ? err?.stack?.split("\n")[1] ?? undefined : "Contact your administrator if this continues.",
      });
    }

    // --- Vision path: new schema with ConvertedIngredient[] ---
    if (visionResult) {
      const ingredients = visionResult.data.ingredients;

      if (ingredients.length === 0 && visionResult.fieldsFound === 0) {
        log.warn({ filename: file.originalname }, "vision extraction returned no data");
        return ok({
          ...visionResult,
          warning: "No recipe data detected. Check that the image is a recipe page and try again.",
          data: { ...visionResult.data, ingredients: [] },
        });
      }

      const enriched = await Promise.all(
        ingredients.map(async (ing) => {
          const match = await findIngredient(ctx.workspaceId, ing.name);
          return {
            ...ing,
            ingredientId:        match?.id ?? null,
            matchedName:         match?.name ?? null,
            matchedCostCents:    match?.currentCostCents ?? null,
            matchedDimension:    match?.dimension ?? null,
            matchedDensityGPerMl: match?.densityGPerMl ?? null,
            matchedCanonicalUnit: match?.canonicalUnit ?? null,
          };
        }),
      );

      return ok({
        ...visionResult,
        data: { ...visionResult.data, ingredients: enriched, ingredientLines: enriched },
      });
    }

    // --- CSV / Excel path: legacy schema with ingredientLines[] ---
    if (csvResult) {
      if (csvResult.data.ingredientLines.length === 0 && csvResult.fieldsFound === 0) {
        log.warn({ filename: file.originalname }, "extraction returned no data");
        return ok({
          ...csvResult,
          warning: "Could not detect recipe columns. Check column headers: expected 'Ingredient' (or 'Item', 'Description'), 'Qty' (or 'Quantity'), 'Unit'. Review and fill in manually.",
          data: { ...csvResult.data, ingredientLines: [] },
        });
      }

      const enriched = await Promise.all(
        csvResult.data.ingredientLines.map(async (line) => {
          const match = await findIngredient(ctx.workspaceId, line.name);
          return {
            ...line,
            ingredientId:        match?.id ?? null,
            matchedName:         match?.name ?? null,
            matchedCostCents:    match?.currentCostCents ?? null,
            matchedDimension:    match?.dimension ?? null,
            matchedDensityGPerMl: match?.densityGPerMl ?? null,
            matchedCanonicalUnit: match?.canonicalUnit ?? null,
          };
        }),
      );

      return ok({
        ...csvResult,
        data: { ...csvResult.data, ingredientLines: enriched },
      });
    }

    // Should never reach here
    throw new BadRequestException({ code: "extraction_failed", message: "No result produced." });
  }
}

function parsedToExtractResult(parsed: SpreadsheetParseResult, source: "excel" | "csv"): RecipeExtractResult | null {
  if (parsed.recipes.length === 0) return null;
  const recipe = parsed.recipes[0]!;
  const data: ExtractedRecipe = {
    name: recipe.name || null,
    authorName: null,
    category: recipe.category ?? null,
    description: recipe.description ?? null,
    totalPortions: recipe.yield_portions ?? null,
    portionWeightOz: null,
    portionVolumeFloz: null,
    prepTimeMinutes: recipe.prep_time_minutes ?? null,
    cookTimeMinutes: recipe.cook_time_minutes ?? null,
    procedure: null,
    goalFoodCostPct: null,
    actualSellPriceCents: null,
    ingredientLines: recipe.ingredients.map(ing => ({
      name: ing.ingredient_name,
      quantity: ing.quantity ?? 1,
      unit: ing.unit ?? "each",
      percentUtilized: ing.utilization_percent ?? null,
      externalCode: ing.vendor_item_code ?? null,
      needsMatch: true,
    })),
  };
  const fieldsFound = [data.name, data.category, data.description, data.totalPortions,
    data.prepTimeMinutes, data.cookTimeMinutes].filter(v => v != null).length
    + (data.ingredientLines?.length ?? 0);
  return { data, source, fieldsFound };
}

const INGREDIENT_SELECT = {
  id: true, name: true,
  currentCostMicrocents: true,
  dimension: true,
  canonicalUnit: true,
  densityGPerMl: true,
} as const;

function mapIngredientMatch(raw: { id: string; name: string; currentCostMicrocents: bigint | null; dimension: string; canonicalUnit: string; densityGPerMl: any } | null) {
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name,
    currentCostCents: raw.currentCostMicrocents != null ? Number(raw.currentCostMicrocents) / 1000 : null,
    dimension: raw.dimension as "MASS" | "VOLUME" | "COUNT",
    canonicalUnit: raw.canonicalUnit,
    densityGPerMl: raw.densityGPerMl != null ? Number(raw.densityGPerMl) : null,
  };
}

async function findIngredient(workspaceId: string, name: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;

  const exact = await prisma.ingredient.findFirst({
    where: { workspaceId, deletedAt: null, name: { equals: normalized, mode: "insensitive" } },
    select: INGREDIENT_SELECT,
  });
  if (exact) return mapIngredientMatch(exact);

  const alias = await prisma.ingredientAlias.findFirst({
    where: { workspaceId, text: normalized },
    include: { ingredient: { select: { ...INGREDIENT_SELECT, deletedAt: true } } },
  });
  if (alias && !alias.ingredient.deletedAt) return mapIngredientMatch(alias.ingredient);

  // Prefix match: require at least 8 chars to avoid false positives.
  // "fresh " (6 chars) incorrectly matched "Fresh Dill Baby Fresh Herb" for "FRESH PASSIONFRUIT JUICE".
  const prefixLen = Math.min(8, normalized.length);
  if (prefixLen >= 8) {
    const prefix = await prisma.ingredient.findFirst({
      where: {
        workspaceId, deletedAt: null,
        name: { startsWith: normalized.slice(0, prefixLen), mode: "insensitive" },
      },
      select: INGREDIENT_SELECT,
    });
    if (prefix) return mapIngredientMatch(prefix);
  }

  return null;
}
