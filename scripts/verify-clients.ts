// Verification for lib/clients.ts — the password login over the app-install
// roster. A bug here logs one client into another's dashboard. Run:
//   pnpm verify:clients
//
// Pure: pickByPassword is the whole decision; getRoster only feeds it rows.
import assert from "node:assert/strict";
import { effectivePassword, pickByPassword, type ClientConfig } from "../lib/clients";

const yconia: ClientConfig = { id: "yconia", name: "Yconia", locationId: "loc-yconia" };
const condesa: ClientConfig = { id: "condesa", name: "Condesa", locationId: "loc-condesa", password: "custom-pw" };
const roster = [yconia, condesa];

// --- password defaults to locationId, override wins
assert.equal(effectivePassword(yconia), "loc-yconia");
assert.equal(effectivePassword(condesa), "custom-pw");

// --- lookups
assert.equal(pickByPassword(roster, "loc-yconia")?.id, "yconia");
assert.equal(pickByPassword(roster, "custom-pw")?.id, "condesa");
// the overridden client's locationId must NOT work as a password
assert.equal(pickByPassword(roster, "loc-condesa"), null);
assert.equal(pickByPassword(roster, "wrong"), null);
assert.equal(pickByPassword(roster, ""), null);
assert.equal(pickByPassword([], "loc-yconia"), null);

// --- an ambiguous password logs in NOBODY (the env roster used to reject this
// at parse time; the table cannot, so the lookup refuses to pick one)
const clash: ClientConfig = { id: "other", name: "Other", locationId: "loc-other", password: "loc-yconia" };
assert.equal(pickByPassword([yconia, clash], "loc-yconia"), null);
assert.equal(pickByPassword([yconia, clash], "loc-other"), null, "clash's own location id is overridden");

console.log("✅ lib/clients.ts — all assertions passed");
