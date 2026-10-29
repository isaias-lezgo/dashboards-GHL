// Creates the cache and OAuth token tables. Idempotent — safe to run on every deploy or by hand.
// Run: pnpm db:migrate
//
// No migration framework: one table does not justify one, and this repo has no
// test framework either. If this ever grows past a couple of tables, revisit.
//
// Wrapped in main() rather than using top-level await: this package is CommonJS
// ("type" is not "module" in package.json), so tsx compiles to CJS where
// top-level await is unavailable. Same gotcha as the verify-* scripts.
import { neon } from "@neondatabase/serverless";

async function main() {
  // DDL goes through the UNPOOLED connection: pgbouncer in transaction mode
  // interferes with schema changes.
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set");
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS project_sync (
      project_id      text PRIMARY KEY,
      payload         bytea       NOT NULL,
      synced_at       timestamptz NOT NULL,
      sync_started_at timestamptz,
      last_error      text
    )
  `;

  // OAuth tokens of the GHL Marketplace app (lib/ghl-oauth.ts). Unlike
  // project_sync these are NOT disposable: dropping ghl_oauth_token means the
  // agency has to reinstall the app. Values are AES-GCM sealed, never plaintext.
  await sql`
    CREATE TABLE IF NOT EXISTS ghl_oauth_token (
      company_id                  text PRIMARY KEY,
      access_token_enc            text        NOT NULL,
      refresh_token_enc           text        NOT NULL,
      expires_at                  timestamptz NOT NULL,
      scope                       text,
      install_to_future_locations boolean,
      approve_all_locations       boolean,
      refresh_started_at          timestamptz,
      last_error                  text,
      installed_at                timestamptz NOT NULL DEFAULT now(),
      updated_at                  timestamptz NOT NULL DEFAULT now()
    )
  `;
  // A cache: losing a row costs one /oauth/locationToken call.
  await sql`
    CREATE TABLE IF NOT EXISTS ghl_location_token (
      location_id      text PRIMARY KEY,
      company_id       text        NOT NULL,
      access_token_enc text        NOT NULL,
      expires_at       timestamptz NOT NULL,
      updated_at       timestamptz NOT NULL DEFAULT now()
    )
  `;

  for (const table of ["project_sync", "ghl_oauth_token", "ghl_location_token"]) {
    const rows = await sql`
      SELECT column_name, data_type
        FROM information_schema.columns
       WHERE table_name = ${table}
       ORDER BY ordinal_position
    `;
    console.log(`✅ ${table} lista:`);
    for (const r of rows) console.log(`   ${r.column_name} ${r.data_type}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
