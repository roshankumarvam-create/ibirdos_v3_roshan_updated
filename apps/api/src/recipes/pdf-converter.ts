import { pdfToPng } from "pdf-to-png-converter";

const MAX_PAGES = 5;

export async function convertPdfToPngs(pdfBuffer: Buffer): Promise<Buffer[]> {
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
  if (pageCount > MAX_PAGES) {
    throw new Error(
      `PDF has ${pageCount} pages — max is ${MAX_PAGES}. Upload a shorter recipe.`,
    );
  }

  // Step 3: render all pages to PNG buffers (in memory, no disk writes).
  const pages = await pdfToPng(pdfBuffer, {
    viewportScale: 2.0,
    disableFontFace: true,
    useSystemFonts: false,
  });

  return pages
    .map((p) => p.content)
    .filter((c): c is Buffer => c != null);
}
