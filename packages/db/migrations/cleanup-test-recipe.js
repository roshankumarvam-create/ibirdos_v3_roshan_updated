// cleanup-test-recipe.js
// Hard-deletes soft-deleted "Cajun Chicken Wings" recipe + its children.
// Uses pg (NOT @prisma/client) to work from repo root.

const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('DB connection OK');

  const targets = await client.query(
    "SELECT id, name, workspace_id, deleted_at FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NOT NULL"
  );
  console.log('Found ' + targets.rows.length + ' soft-deleted recipe(s) named Cajun Chicken Wings');

  if (targets.rows.length === 0) {
    console.log('Nothing to delete. Checking active rows...');
    const active = await client.query(
      "SELECT id FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NULL"
    );
    if (active.rows.length > 0) {
      console.log('Active recipe still exists. Delete it from UI first.');
    } else {
      console.log('No recipes with this name. Re-import should work.');
    }
    await client.end();
    return;
  }

  await client.query('BEGIN');
  try {
    const links = await client.query(
      "DELETE FROM recipe_ingredients WHERE recipe_id IN (SELECT id FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NOT NULL)"
    );
    console.log('Deleted ' + links.rowCount + ' recipe_ingredient row(s)');

    const recipes = await client.query(
      "DELETE FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NOT NULL"
    );
    console.log('Deleted ' + recipes.rowCount + ' recipe row(s)');

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  const remaining = await client.query(
    "SELECT COUNT(*)::int AS cnt FROM recipes WHERE LOWER(name) = 'cajun chicken wings' AND deleted_at IS NOT NULL"
  );
  if (remaining.rows[0].cnt !== 0) {
    throw new Error('VERIFY FAILED: ' + remaining.rows[0].cnt + ' rows still remain');
  }
  console.log('Verified: 0 soft-deleted Cajun Chicken Wings remain');

  await client.end();
  console.log('Cleanup complete. You can re-import the XLSX.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
