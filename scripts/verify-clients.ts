// Verification for lib/clients.ts. Run: pnpm verify:clients
import assert from "node:assert/strict";
import { parseClients, getClientById } from "../lib/clients";

const VALID = JSON.stringify([
  { id: "yconia", name: "Yconia", locationId: "loc-yconia", ghlToken: "pit-a" },
  { id: "condesa", name: "Condesa", locationId: "loc-condesa", ghlToken: "pit-b" },
]);

function throws(raw: string, needle: string, label: string) {
  assert.throws(
    () => parseClients(raw),
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      assert.ok(msg.includes(needle), `${label}: expected message to include "${needle}", got "${msg}"`);
      return true;
    },
    label,
  );
}

// --- parse + shape
const clients = parseClients(VALID);
assert.equal(clients.length, 2);
assert.equal(clients[0].id, "yconia");
assert.equal(clients[0].locationId, "loc-yconia");
assert.equal(clients[1].name, "Condesa");

// --- a stray `password` key in the JSON is ignored, not carried through.
// Rosters written under the old model must not smuggle a dead field into ClientConfig.
const legacy = parseClients(
  JSON.stringify([{ id: "a", name: "A", locationId: "l", ghlToken: "t", password: "old" }]),
);
assert.equal((legacy[0] as unknown as Record<string, unknown>).password, undefined);

// --- two projects MAY now share a locationId (it is no longer a password)
const shared = parseClients(
  JSON.stringify([
    { id: "a", name: "A", locationId: "same", ghlToken: "t1" },
    { id: "b", name: "B", locationId: "same", ghlToken: "t2" },
  ]),
);
assert.equal(shared.length, 2);

// --- validation failures
throws("not json", "not valid JSON", "malformed JSON");
throws(JSON.stringify({ id: "x" }), "must be a JSON array", "not an array");
throws("[]", "no clients configured", "empty array");
throws(JSON.stringify([{ id: "a", name: "A", locationId: "l" }]), "ghlToken", "missing ghlToken");
throws(JSON.stringify([{ id: "a", name: "A", locationId: "l", ghlToken: "" }]), "ghlToken", "empty ghlToken");
throws(JSON.stringify([{ id: "A.b", name: "A", locationId: "l", ghlToken: "t" }]), "invalid id", "id with a dot");
throws(
  JSON.stringify([
    { id: "a", name: "A", locationId: "l1", ghlToken: "t" },
    { id: "a", name: "B", locationId: "l2", ghlToken: "t" },
  ]),
  "duplicate id",
  "duplicate id",
);

// --- env-backed lookups
process.env.DASHBOARD_CLIENTS = VALID;
assert.equal(getClientById("yconia")?.name, "Yconia");
assert.equal(getClientById("nope"), null);

console.log("✅ lib/clients.ts — all assertions passed");
