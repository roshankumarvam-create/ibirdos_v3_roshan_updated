// =====================================================================
// packages/db/migrations/fix-r2-photo-urls.js
//
// Rewrites recipe photo URLs that were stored using the internal
// S3-compatible endpoint (R2_ENDPOINT/R2_BUCKET/key) to the public
// CDN URL (R2_PUBLIC_URL/key). This happens when photos were uploaded
// before R2_PUBLIC_URL was set in the API environment.
//
// Run ONCE from packages/db/ after Railway redeploy:
//   $env:DATABASE_URL   = "<production DATABASE_PUBLIC_URL>"
//   $env:R2_ENDPOINT    = "<your R2 endpoint>"
//   $env:R2_BUCKET      = "<your bucket name>"
//   $env:R2_PUBLIC_URL  = "<your public CDN URL>"
//   node migrations/fix-r2-photo-urls.js
//
// Dry run (print changes, do NOT write):
//   $env:DRY_RUN = "true"
//   node migrations/fix-r2-photo-urls.js
// =====================================================================

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const { R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_URL, DRY_RUN } = process.env;
  const isDryRun = DRY_RUN === "true";

  if (!R2_ENDPOINT) { console.error("✗ R2_ENDPOINT env var is required"); process.exit(1); }
  if (!R2_BUCKET)   { console.error("✗ R2_BUCKET env var is required");   process.exit(1); }
  if (!R2_PUBLIC_URL) { console.error("✗ R2_PUBLIC_URL env var is required"); process.exit(1); }

  const oldPrefix = `${R2_ENDPOINT}/${R2_BUCKET}/`;
  const newPrefix = `${R2_PUBLIC_URL}/`;

  console.log(isDryRun
    ? "╔══════════════════════════════════════════════════╗\n║  fix-r2-photo-urls  [DRY RUN — no writes]       ║\n╚══════════════════════════════════════════════════╝"
    : "╔══════════════════════════════════════════════════╗\n║  fix-r2-photo-urls  [LIVE — writing changes]    ║\n╚══════════════════════════════════════════════════╝"
  );
  console.log(`\nOld prefix: ${oldPrefix}`);
  console.log(`New prefix: ${newPrefix}\n`);

  // ----------------------------------------------------------------
  // SELECT: find all recipes with at least one broken photo URL
  // ----------------------------------------------------------------
  const findBroken = () => prisma.recipe.findMany({
    where: {
      OR: [
        { photoUrl:      { startsWith: oldPrefix } },
        { prepPhotoUrl:  { startsWith: oldPrefix } },
        { finalPhotoUrl: { startsWith: oldPrefix } },
        { videoUrl:      { startsWith: oldPrefix } },
      ],
    },
    select: { id: true, photoUrl: true, prepPhotoUrl: true, finalPhotoUrl: true, videoUrl: true },
  });

  const recipes = await findBroken();
  console.log(`Found ${recipes.length} recipe(s) with broken URLs.`);

  if (recipes.length === 0) {
    console.log("\n✓ Nothing to do — all URLs are already correct.");
    return;
  }

  // ----------------------------------------------------------------
  // Compute which fields change (for reporting)
  // ----------------------------------------------------------------
  const rewrite = (url) =>
    url && url.startsWith(oldPrefix) ? newPrefix + url.slice(oldPrefix.length) : url;

  let totalFieldsFixed = 0;
  for (const r of recipes) {
    if (r.photoUrl      && r.photoUrl.startsWith(oldPrefix))      totalFieldsFixed++;
    if (r.prepPhotoUrl  && r.prepPhotoUrl.startsWith(oldPrefix))  totalFieldsFixed++;
    if (r.finalPhotoUrl && r.finalPhotoUrl.startsWith(oldPrefix)) totalFieldsFixed++;
    if (r.videoUrl      && r.videoUrl.startsWith(oldPrefix))      totalFieldsFixed++;
  }

  // ----------------------------------------------------------------
  // Dry-run: print what would change, then exit
  // ----------------------------------------------------------------
  if (isDryRun) {
    for (const r of recipes) {
      const changed = [];
      if (r.photoUrl      && r.photoUrl.startsWith(oldPrefix))      changed.push(["photoUrl",      r.photoUrl]);
      if (r.prepPhotoUrl  && r.prepPhotoUrl.startsWith(oldPrefix))  changed.push(["prepPhotoUrl",  r.prepPhotoUrl]);
      if (r.finalPhotoUrl && r.finalPhotoUrl.startsWith(oldPrefix)) changed.push(["finalPhotoUrl", r.finalPhotoUrl]);
      if (r.videoUrl      && r.videoUrl.startsWith(oldPrefix))      changed.push(["videoUrl",      r.videoUrl]);
      console.log(`\n  [${r.id}]`);
      for (const [field, url] of changed) {
        console.log(`    ${field}`);
        console.log(`      OLD: ${url}`);
        console.log(`      NEW: ${rewrite(url)}`);
      }
    }
    console.log(`\nDRY RUN complete. Would fix ${recipes.length} row(s) across ${totalFieldsFixed} field(s).`);
    console.log("Re-run without DRY_RUN=true to apply.");
    return;
  }

  // ----------------------------------------------------------------
  // LIVE: wrap all UPDATEs in a single transaction
  // ----------------------------------------------------------------
  await prisma.$transaction(async (tx) => {
    for (const r of recipes) {
      await tx.recipe.update({
        where: { id: r.id },
        data: {
          photoUrl:      rewrite(r.photoUrl)      ?? null,
          prepPhotoUrl:  rewrite(r.prepPhotoUrl)  ?? null,
          finalPhotoUrl: rewrite(r.finalPhotoUrl) ?? null,
          videoUrl:      rewrite(r.videoUrl)      ?? null,
        },
      });
      console.log(`  ✓ updated ${r.id}`);
    }
  });

  // ----------------------------------------------------------------
  // POST-STATE VERIFICATION: re-run the same SELECT — must return 0
  // ----------------------------------------------------------------
  console.log("\nVerifying post-state...");
  const remaining = await findBroken();

  if (remaining.length > 0) {
    const ids = remaining.map(r => r.id).join(", ");
    throw new Error(
      `VERIFICATION FAILED: ${remaining.length} row(s) still have broken URLs after migration.\n` +
      `Affected IDs: ${ids}\n` +
      "Check the above rows manually."
    );
  }

  console.log("✓ Verification passed — 0 broken URLs remain.");
  console.log(`\n✓ Migration complete. Fixed ${recipes.length} row(s) across ${totalFieldsFixed} field(s).`);
}

main()
  .catch((e) => {
    console.error("\n✗ Migration failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
