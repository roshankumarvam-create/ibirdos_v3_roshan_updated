// fix-soft-delete-uniqueness.js
// Deletes orphaned ingredient_alias rows for soft-deleted ingredients.
// Uses pg (NOT @prisma/client) to work from repo root.
// IDEMPOTENT - safe to re-run.

const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('DB connection OK');

  const before = await client.query(
    "SELECT COUNT(*)::int AS cnt FROM ingredient_aliases WHERE ingredient_id IN (SELECT id FROM ingredients WHERE deleted_at IS NOT NULL)"
  );
  const count = before.rows[0].cnt;
  console.log('Orphaned aliases found: ' + count);

  if (count === 0) {
    console.log('Nothing to delete. Already clean.');
    await client.end();
    return;
  }

  const sample = await client.query(
    "SELECT a.id, a.text, i.name as ing_name FROM ingredient_aliases a JOIN ingredients i ON i.id = a.ingredient_id WHERE i.deleted_at IS NOT NULL LIMIT 10"
  );
  console.log('Sample orphans (first 10):');
  for (const r of sample.rows) {
    console.log('  - text="' + r.text + '" ingredient="' + r.ing_name + '"');
  }

  await client.query('BEGIN');
  try {
    const result = await client.query(
      "DELETE FROM ingredient_aliases WHERE ingredient_id IN (SELECT id FROM ingredients WHERE deleted_at IS NOT NULL)"
    );
    console.log('Deleted ' + result.rowCount + ' orphaned alias row(s)');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  const after = await client.query(
    "SELECT COUNT(*)::int AS cnt FROM ingredient_aliases WHERE ingredient_id IN (SELECT id FROM ingredients WHERE deleted_at IS NOT NULL)"
  );
  if (after.rows[0].cnt !== 0) {
    throw new Error('VERIFY FAILED: ' + after.rows[0].cnt + ' orphans still remain');
  }
  console.log('Verified: 0 orphans remain');

  const activeAliases = await client.query("SELECT COUNT(*)::int AS cnt FROM ingredient_aliases");
  console.log('Active aliases intact: ' + activeAliases.rows[0].cnt);

  await client.end();
  console.log('Migration complete.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
