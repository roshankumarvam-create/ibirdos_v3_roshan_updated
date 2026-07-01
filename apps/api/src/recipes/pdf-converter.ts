import { pdfToPng } from "pdf-to-png-converter";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("pdf-converter");
const MAX_PAGES = 5;
const MIN_PNG_BYTES = 10_000; // 10 KB — a blank or failed render is far smaller

export async function convertPdfToPngs(pdfBuffer: Buffer, maxPages = MAX_PAGES): Promise<Buffer[]> {
  // Step 1: get page count via metadata-only pass (no PNG rendering — fast).
  // Also detects encrypted PDFs (pdfjs throws PasswordException here) and corrupt files.
  let pageCount: number;
  try {
    const meta = await pdfToPng(pdfBuffer, { returnMetadataOnly: true });
    pageCount = meta.length;
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (/password|encrypted|protect/i.test(msg) || err?.name === "PasswordException") {
      throw new Error(
        "Password-protected PDFs aren't supported. Remove the password and try again.",
      );
    }
    throw new Error(`Could not read PDF. The file may be corrupted. (${msg})`);
  }

  // Step 2: enforce page cap BEFORE any rendering.
  if (pageCount > maxPages) {
    throw new Error(
      `PDF has ${pageCount} pages — max is ${maxPages}. Upload a shorter recipe.`,
    );
  }

  // Step 3: render all pages to PNG buffers (in memory, no disk writes).
  // viewportScale 3.0 → ~216 DPI effective for text-heavy recipe tables.
  // disableFontFace: false → use embedded fonts for accurate text rendering.
  const pages = await pdfToPng(pdfBuffer, {
    viewportScale: 3.0,
    disableFontFace: false,
    useSystemFonts: false,
  });

  const buffers: Buffer[] = [];
  for (const page of pages) {
    if (page.content == null) continue;
    if (page.content.length < MIN_PNG_BYTES) {
      throw new Error(
        "PDF page rendered as a near-blank image. Try converting the PDF to PNG or JPG before uploading.",
      );
    }
    log.info(
      { pageNumber: page.pageNumber, bufferBytes: page.content.length, width: page.width, height: page.height },
      "pdf page converted to png",
    );
    buffers.push(page.content);
  }

  return buffers;
}
