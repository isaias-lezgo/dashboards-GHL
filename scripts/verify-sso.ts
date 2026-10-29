// Assertions for lib/ghl-sso.ts — the decryption that decides WHICH sub-account
// a GHL user is logged into. A silent bug here is a cross-tenant leak: client A
// opening the Dashboard menu and getting client B's numbers.
//
// Pure: no network, no database. Wrapped in main() for parity with the other
// verify-* scripts (CommonJS under tsx, no top-level await).
import assert from "node:assert/strict";
import {
  AGENCY_COMPANY_ID,
  decideSso,
  decryptUserContext,
  encryptLikeCryptoJs,
} from "../lib/ghl-sso";

const KEY = "5e2abf42-0000-4b99-af58-000000000000";

function ctx(extra: Record<string, unknown>) {
  return JSON.stringify({ userId: "u1", companyId: AGENCY_COMPANY_ID, type: "location", activeLocation: "loc-1", userName: "José Ñ", ...extra });
}

async function main() {
  // Known-answer vector produced by crypto-js 4 itself (the salt is embedded in
  // the ciphertext), so this pins our EVP_BytesToKey + CBC to GHL's actual
  // format, not merely to our own encrypt function:
  //   CryptoJS.AES.encrypt('{"userId":"u1","companyId":"c1","type":"agency"}', "secret").toString()
  const fromCryptoJs = "U2FsdGVkX1+tY0HvhHMXS6wko2mFfT1JPDZhU5haBm5Iha37Gtmb7RQQVgeqZRwUWStw9fJ+beiRQHlH/GJYvmtqb2eP6yTpDRCWESa6AWA=";
  const known = decryptUserContext(fromCryptoJs, "secret");
  assert.equal(known.userId, "u1");
  assert.equal(known.companyId, "c1");
  assert.equal(known.type, "agency");

  const sealed = encryptLikeCryptoJs(ctx({}), KEY);
  const decoded = decryptUserContext(sealed, KEY);
  assert.equal(decoded.activeLocation, "loc-1");
  assert.equal(decoded.userName, "José Ñ", "utf-8 survives");

  assert.throws(() => decryptUserContext(sealed, KEY + "x"), "wrong key must be rejected");
  assert.throws(() => decryptUserContext("bm90IGEgY2lwaGVydGV4dA==", KEY), "non-CryptoJS input");
  assert.throws(() => decryptUserContext(encryptLikeCryptoJs('{"userId":"u1"}', KEY), KEY), "missing companyId");
  assert.throws(() => decryptUserContext(encryptLikeCryptoJs(ctx({ type: "admin" }), KEY), KEY), "unknown type");

  assert.deepEqual(decideSso(decoded), { ok: true, locationId: "loc-1" });
  assert.deepEqual(
    decideSso(decryptUserContext(encryptLikeCryptoJs(ctx({ companyId: "other-agency" }), KEY), KEY)),
    { ok: false, reason: "wrong_agency" },
  );
  assert.deepEqual(
    decideSso(decryptUserContext(encryptLikeCryptoJs(ctx({ type: "agency", activeLocation: undefined }), KEY), KEY)),
    { ok: false, reason: "agency_view" },
  );
  assert.deepEqual(
    decideSso(decryptUserContext(encryptLikeCryptoJs(ctx({ activeLocation: "" }), KEY), KEY)),
    { ok: false, reason: "agency_view" },
  );
  console.log("✅ SSO: descifrado y decisión de tenant");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
