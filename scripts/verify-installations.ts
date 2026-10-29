// Assertions for lib/installations.ts + lib/ghl-webhook.ts — the pieces that
// turn a client's dashboard on and off. Failure modes worth a script:
//   - an auto-assigned client id colliding with a configured one (two tenants,
//     one session id, one cache row);
//   - a forged webhook accepted (anyone could switch a client's dashboard off);
//   - an uninstall that leaves the client's cached payload behind.
//
// Pure assertions always run; the cleanup assertions need DATABASE_URL and the
// tables from `pnpm db:migrate`. Wrapped in main(): CommonJS under tsx.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { slugify, uniqueClientId, markUninstalled } from "../lib/installations";
import { verifyGhlWebhook } from "../lib/ghl-webhook";
import { getSql, isDbConfigured } from "../lib/db";

const TEST_LOC = "__verify_installations_loc__";
const TEST_ID = "verify-installations-test";

function pure() {
  assert.equal(slugify("Stanza Residencial"), "stanza-residencial");
  assert.equal(slugify("Terrenos en Venta | Jerry Medina"), "terrenos-en-venta-jerry-medina");
  assert.equal(slugify("Ñandú & Café Méxicó"), "nandu-cafe-mexico");
  assert.equal(slugify("   ***   "), "cliente");
  assert.match(slugify("x".repeat(200)), /^x{48}$/);

  const taken = new Set(["sahai", "hausmen"]);
  assert.equal(uniqueClientId("Nuevo Cliente", "AbC123xyz", taken), "nuevo-cliente");
  assert.equal(uniqueClientId("Sahai", "1OKEzazrVic5", taken), "sahai-1okeza", "collision gets a location suffix");
  taken.add("sahai-1okeza");
  assert.equal(uniqueClientId("Sahai", "1OKEzazrVic5", taken), "sahai-1okeza-2");
  for (const id of ["nuevo-cliente", "sahai-1okeza-2"]) assert.match(id, /^[a-z0-9-]+$/, "session-token-safe id");
  console.log("✅ ids de cliente");

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const body = JSON.stringify({ type: "UNINSTALL", appId: "a", locationId: "l" });
  const sig = sign(null, Buffer.from(body), privateKey).toString("base64");
  assert.equal(verifyGhlWebhook(body, sig, publicKey), true, "valid signature");
  const pretty = JSON.stringify(JSON.parse(body), null, 2);
  assert.equal(verifyGhlWebhook(pretty, sig, publicKey), true, "signature over the compact JSON of a pretty body");
  assert.equal(verifyGhlWebhook(body.replace('"l"', '"other"'), sig, publicKey), false, "tampered body");
  assert.equal(verifyGhlWebhook(body, null, publicKey), false, "missing signature");
  assert.equal(verifyGhlWebhook(body, "bm9wZQ==", publicKey), false, "short signature");
  const other = generateKeyPairSync("ed25519").publicKey;
  assert.equal(verifyGhlWebhook(body, sig, other), false, "signed by someone else");
  // GHL's real key must parse; a forged signature against it must fail cleanly.
  assert.equal(verifyGhlWebhook(body, sig), false, "our signature is not GHL's");
  console.log("✅ firma de webhooks (Ed25519)");
}

async function db() {
  if (!isDbConfigured()) {
    console.log("⏭️  sin DATABASE_URL: se omite la limpieza al desinstalar");
    return;
  }
  const sql = getSql();
  const cleanup = async () => {
    await sql`DELETE FROM dashboard_installation WHERE location_id = ${TEST_LOC}`;
    await sql`DELETE FROM ghl_location_token WHERE location_id = ${TEST_LOC}`;
    await sql`DELETE FROM project_sync WHERE project_id = ${TEST_ID}`;
  };
  try {
    await cleanup();
    // The row is live in the shared table for the milliseconds this runs; its
    // fake location means no SSO or password can ever resolve to it.
    await sql`INSERT INTO dashboard_installation (location_id, client_id, name) VALUES (${TEST_LOC}, ${TEST_ID}, 'Verify')`;
    await sql`INSERT INTO ghl_location_token (location_id, company_id, access_token_enc, expires_at) VALUES (${TEST_LOC}, 'c', 'x', now())`;
    await sql`INSERT INTO project_sync (project_id, payload, synced_at) VALUES (${TEST_ID}, ''::bytea, now())`;

    await markUninstalled(TEST_LOC);
    const [inst] = await sql`SELECT uninstalled_at FROM dashboard_installation WHERE location_id = ${TEST_LOC}`;
    assert.ok(inst.uninstalled_at, "row is stamped, not deleted");
    assert.equal((await sql`SELECT 1 FROM ghl_location_token WHERE location_id = ${TEST_LOC}`).length, 0, "token dropped");
    assert.equal((await sql`SELECT 1 FROM project_sync WHERE project_id = ${TEST_ID}`).length, 0, "cached payload dropped");

    // Idempotent: a duplicate UNINSTALL delivery is harmless.
    await markUninstalled(TEST_LOC);
    console.log("✅ desinstalar limpia token y caché (Postgres)");
  } finally {
    await cleanup();
  }
}

async function main() {
  pure();
  await db();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
