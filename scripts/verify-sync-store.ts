// Assertions for lib/sync-store.ts — the module that decides which cached payload
// a client sees. A silent bug here is a cross-tenant data leak: client A's
// dashboard rendered with client B's numbers.
//
// The pure assertions always run. The Postgres round-trip only runs when
// DATABASE_URL is set, so this script stays useful before the database exists.
//
// Wrapped in main(): this package is CommonJS, so tsx compiles to CJS where
// top-level await is unavailable. Same gotcha as the other verify-* scripts.
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { isStale, FRESH_WINDOW_MS, readSync, writeSync, claimSync, releaseSync } from "../lib/sync-store";
import { isDbConfigured, getSql } from "../lib/db";
import type { ClientConfig } from "../lib/clients";
import type { DashboardPayload } from "../lib/types";

// Ids that cannot collide with the real roster, so a botched run never touches a
// live client's cached payload. Deleted at the end regardless of outcome.
const TEST_A: ClientConfig = {
  id: "__verify_sync_store_a__",
  name: "Verify A",
  locationId: "loc-a",
  ghlToken: "pit-fake-a",
};
const TEST_B: ClientConfig = {
  id: "__verify_sync_store_b__",
  name: "Verify B",
  locationId: "loc-b",
  ghlToken: "pit-fake-b",
};

function payloadFixture(marker: string): DashboardPayload {
  return {
    locationName: marker,
    // Accents and emoji are not decoration: real contact names carry them, and a
    // latin-1 round-trip would corrupt them somewhere no test would notice.
    contacts: [
      {
        id: "c1",
        name: "José Ñandú 🚀 Müller",
        email: "",
        phone: "",
        tags: [],
        dateAdded: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    opportunities: [],
    calls: [],
    tasks: [],
    appointments: [],
    pipelines: [],
    members: [],
    tags: [],
    campaigns: [],
    sources: [],
    pautas: [],
    locationId: marker,
    meta: {
      totalContacts: 1,
      totalOpportunities: 0,
      fetchedAt: "2026-08-19T12:00:00.000Z",
    },
  };
}

function pureAssertions() {
  const now = new Date("2026-08-19T12:00:00.000Z");

  // Both edges of the fresh window.
  const justInside = new Date(now.getTime() - (FRESH_WINDOW_MS - 1000));
  const exactlyAt = new Date(now.getTime() - FRESH_WINDOW_MS);
  const wellPast = new Date(now.getTime() - 60 * 60 * 1000);
  assert.equal(isStale(justInside, now), false, "1s inside the window is fresh");
  assert.equal(isStale(exactlyAt, now), true, "exactly at the window is stale");
  assert.equal(isStale(wellPast, now), true, "an hour old is stale");

  // Accepts an ISO string as well as a Date — readSync hands back a string.
  assert.equal(isStale(wellPast.toISOString(), now), true, "ISO strings work too");

  // Clock skew: synced_at in the future must NOT resync on every visit.
  const future = new Date(now.getTime() + 60 * 60 * 1000);
  assert.equal(isStale(future, now), false, "a future synced_at is treated as fresh");

  // The compression round-trip must be byte-exact, accents and emoji included.
  const original = payloadFixture("compresión-🚀");
  const restored = JSON.parse(gunzipSync(gzipSync(Buffer.from(JSON.stringify(original), "utf8"))).toString("utf8"));
  assert.deepEqual(restored, original, "gzip round-trip preserves the payload exactly");

  console.log("✅ puras: ventana de frescura, reloj chueco y round-trip de gzip");
}

async function dbAssertions() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS project_sync (
      project_id      text PRIMARY KEY,
      payload         bytea       NOT NULL,
      synced_at       timestamptz NOT NULL,
      sync_started_at timestamptz,
      last_error      text
    )
  `;

  try {
    // A client that was never synced has no cache.
    assert.equal(await readSync(TEST_A), null, "an unknown client reads as no cache");

    // Round-trip through Postgres, not just through zlib.
    const a = payloadFixture("A");
    await writeSync(TEST_A, a);
    const readA = await readSync(TEST_A);
    assert.ok(readA, "the payload just written reads back");
    assert.deepEqual(readA.payload, a, "Postgres round-trip is exact");
    assert.equal(readA.syncedAt, a.meta.fetchedAt, "synced_at comes from the payload, not now()");

    // Isolation: writing B must not disturb A. This is the assertion that would
    // have caught pointing two deployments at one database.
    const b = payloadFixture("B");
    await writeSync(TEST_B, b);
    const stillA = await readSync(TEST_A);
    assert.equal(stillA?.payload.locationName, "A", "writing B left A alone");
    assert.equal((await readSync(TEST_B))?.payload.locationName, "B", "B reads back as B");

    // The lock cannot be taken twice. writeSync above cleared it, so the first
    // claim succeeds and the second — with no timeout elapsed — must fail.
    assert.equal(await claimSync(TEST_A), true, "a free lock can be claimed");
    assert.equal(await claimSync(TEST_A), false, "a held lock cannot be claimed again");

    // The lock is self-healing: a claim older than the timeout is reclaimable, so
    // a function that dies mid-sync cannot freeze a client forever.
    await sql`
      UPDATE project_sync SET sync_started_at = now() - interval '11 minutes'
       WHERE project_id = ${TEST_A.id}
    `;
    assert.equal(await claimSync(TEST_A), true, "a stale lock is reclaimable");

    // releaseSync must not touch the payload: a failed refresh keeps the last
    // good cache rather than blanking it.
    await releaseSync(TEST_A, "boom");
    const afterRelease = await readSync(TEST_A);
    assert.deepEqual(afterRelease?.payload, a, "a released lock left the payload intact");

    // A zero-byte payload (claimSync seeded it, then the sync failed) reads as
    // "no cache" rather than throwing out of gunzip.
    await sql`
      UPDATE project_sync SET payload = ''::bytea WHERE project_id = ${TEST_A.id}
    `;
    assert.equal(await readSync(TEST_A), null, "an empty payload means no cache, not corrupt");

    console.log("✅ Postgres: round-trip, aislamiento entre clientes, candado y auto-sanado");
  } finally {
    await sql`
      DELETE FROM project_sync WHERE project_id IN (${TEST_A.id}, ${TEST_B.id})
    `;
  }
}

async function main() {
  pureAssertions();
  if (isDbConfigured()) {
    await dbAssertions();
  } else {
    console.log("⏭  DATABASE_URL ausente — se omitieron las aserciones contra Postgres");
  }
  console.log("✅ verify:sync-store OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
