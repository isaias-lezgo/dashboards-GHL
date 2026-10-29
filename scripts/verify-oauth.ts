// Assertions for lib/ghl-oauth.ts — the module holding the agency's Company
// token, which reads every sub-account. Two silent failures matter here:
//   - a sealed token that decrypts under the wrong key or after tampering;
//   - two concurrent refreshes both redeeming the single-use refresh token,
//     which can cost the install.
//
// The pure assertions always run. The lock assertions run only when
// DATABASE_URL is set and the OAuth tables exist (pnpm db:migrate).
//
// Wrapped in main(): this package is CommonJS, so tsx compiles to CJS where
// top-level await is unavailable. Same gotcha as the other verify-* scripts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  claimRefresh,
  decryptToken,
  encryptToken,
  expiresAtFrom,
  needsRefresh,
  REFRESH_MARGIN_MS,
} from "../lib/ghl-oauth";
import { getSql, isDbConfigured } from "../lib/db";

// Cannot collide with a real GHL company id. Deleted at the end regardless.
const TEST_COMPANY = "__verify_oauth__";

function pure() {
  const key = randomBytes(32);
  const other = randomBytes(32);
  const token = "eyJhbGciOi.payload-with-ñ-and-🚀.sig";

  const sealed = encryptToken(token, key);
  assert.equal(decryptToken(sealed, key), token, "round-trip");
  assert.ok(!sealed.includes("payload"), "ciphertext must not contain the plaintext");
  assert.notEqual(encryptToken(token, key), sealed, "random IV: same input seals differently");

  assert.throws(() => decryptToken(sealed, other), "wrong key must throw, not return garbage");
  const parts = sealed.split(".");
  const flipped = Buffer.from(parts[3], "base64url");
  flipped[0] ^= 1;
  parts[3] = flipped.toString("base64url");
  assert.throws(() => decryptToken(parts.join("."), key), "tampered ciphertext must throw");
  assert.throws(() => decryptToken("v2.a.b.c", key), "unknown version must throw");

  const now = new Date("2026-10-28T12:00:00Z");
  assert.equal(expiresAtFrom(86399, now).toISOString(), "2026-10-29T11:59:59.000Z");
  assert.equal(needsRefresh(new Date(now.getTime() + REFRESH_MARGIN_MS + 1000), now), false, "outside margin");
  assert.equal(needsRefresh(new Date(now.getTime() + REFRESH_MARGIN_MS), now), true, "at margin");
  assert.equal(needsRefresh(new Date(now.getTime() - 1000), now), true, "expired");
  console.log("✅ cifrado y vencimiento");
}

async function lock() {
  if (!isDbConfigured()) {
    console.log("⏭️  sin DATABASE_URL: se omiten las pruebas del lock");
    return;
  }
  const sql = getSql();
  const seed = async (expiresInSeconds: number, lockedSecondsAgo: number | null) => {
    await sql`DELETE FROM ghl_oauth_token WHERE company_id = ${TEST_COMPANY}`;
    await sql`
      INSERT INTO ghl_oauth_token (company_id, access_token_enc, refresh_token_enc, expires_at, refresh_started_at)
      VALUES (${TEST_COMPANY}, 'a', 'sealed-refresh', now() + make_interval(secs => ${expiresInSeconds}),
              ${lockedSecondsAgo === null ? null : new Date(Date.now() - lockedSecondsAgo * 1000)})
    `;
  };

  try {
    // Expiring token, 10 concurrent claimers: exactly one wins.
    await seed(60, null);
    const results = await Promise.all(Array.from({ length: 10 }, () => claimRefresh(TEST_COMPANY)));
    assert.equal(results.filter((r) => r !== null).length, 1, "exactly one concurrent claimer gets the refresh token");
    assert.equal(results.find((r) => r !== null), "sealed-refresh");

    // Token still fresh: nobody claims — a late caller must not redeem again.
    await seed(24 * 3600, null);
    assert.equal(await claimRefresh(TEST_COMPANY), null, "fresh token is never claimed");

    // Lock held recently: not stealable.
    await seed(60, 10);
    assert.equal(await claimRefresh(TEST_COMPANY), null, "a live lock is respected");

    // Lock abandoned: self-heals.
    await seed(60, 600);
    assert.equal(await claimRefresh(TEST_COMPANY), "sealed-refresh", "an abandoned lock is taken over");

    // Unknown company: nothing.
    assert.equal(await claimRefresh("__no_such_company__"), null);
    console.log("✅ lock de refresh (Postgres)");
  } finally {
    await sql`DELETE FROM ghl_oauth_token WHERE company_id = ${TEST_COMPANY}`;
  }
}

async function main() {
  pure();
  await lock();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
