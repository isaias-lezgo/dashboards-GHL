// Verification for lib/ghl-context.ts. Run: pnpm verify:context
//
// This module is the tenant-isolation seam: ghlFetch reads its credentials from
// here, so a bug means one project's dashboard rendered with another's token.
// Wrapped in main() rather than using top-level await: this package is CJS
// ("type" is not "module"), so tsx compiles to CJS where TLA is unavailable.
import assert from "node:assert/strict";
import { withClient, currentClient, reportRetry } from "../lib/ghl-context";
import type { ClientConfig } from "../lib/clients";

const A: ClientConfig = { id: "a", name: "A", locationId: "loc-a", ghlToken: "pit-a" };
const B: ClientConfig = { id: "b", name: "B", locationId: "loc-b", ghlToken: "pit-b" };

async function main() {
  // --- FAILS CLOSED: no context means throw, never a default token
  assert.throws(() => currentClient(), /No GHL client context/, "outside withClient must throw");

  // --- the client is readable inside the context
  withClient(A, () => {
    assert.equal(currentClient().ghlToken, "pit-a");
  });

  // --- THE ISOLATION GUARANTEE: overlapping async work keeps separate stores.
  // One serverless instance serves concurrent requests; if these bled into each
  // other, a project would be served with another project's credentials.
  const seen: string[] = [];
  await Promise.all([
    withClient(A, async () => {
      await new Promise((r) => setTimeout(r, 20));
      seen.push(currentClient().ghlToken);
    }),
    withClient(B, async () => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(currentClient().ghlToken);
    }),
  ]);
  assert.deepEqual(seen.sort(), ["pit-a", "pit-b"], "concurrent contexts must not bleed");

  // --- the context does not leak past its callback
  assert.throws(() => currentClient(), /No GHL client context/, "context must not outlive withClient");

  // --- retry reporting reaches the caller's reporter
  const notices: number[] = [];
  withClient(
    A,
    () => {
      reportRetry({ status: 522, attempt: 1, maxAttempts: 5, delayMs: 15_000 });
      reportRetry({ status: 429, attempt: 2, maxAttempts: 5, delayMs: 10_000 });
    },
    (n) => notices.push(n.status),
  );
  assert.deepEqual(notices, [522, 429], "retry notices must reach the reporter");

  // --- reporting is diagnostics ONLY: it must never affect the request
  withClient(A, () => {
    assert.doesNotThrow(
      () => reportRetry({ status: 522, attempt: 1, maxAttempts: 5, delayMs: 1000 }),
      "no reporter must be a no-op, not a crash",
    );
  });
  withClient(
    A,
    () => {
      assert.doesNotThrow(
        () => reportRetry({ status: 522, attempt: 1, maxAttempts: 5, delayMs: 1000 }),
        "a throwing reporter must not fail the sync",
      );
    },
    () => {
      throw new Error("reporter exploded");
    },
  );

  // --- reporting outside any context is a no-op, not a throw
  assert.doesNotThrow(
    () => reportRetry({ status: 522, attempt: 1, maxAttempts: 5, delayMs: 1000 }),
    "reportRetry outside a context must be a no-op",
  );

  console.log("✅ lib/ghl-context.ts — all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
