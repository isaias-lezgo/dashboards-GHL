// Verification for lib/ghl-limiter.ts. Run: npm run verify:limiter
//
// Wrapped in main() rather than using top-level await: this package is CJS.
import assert from "node:assert/strict";
import {
  acquireSlot,
  releaseSlot,
  note429,
  __resetLimiters,
  __peek,
  serverErrorDelayMs,
  rateLimitCooldownMs,
  MAX_SERVER_BACKOFF_MS,
  MAX_429_COOLDOWN_MS,
} from "../lib/ghl-limiter";

const A = "loc-yconia";
const B = "loc-condesa";

async function main() {
  __resetLimiters();

  // --- limiters are independent per location
  await acquireSlot(A);
  await acquireSlot(A);
  assert.equal(__peek(A).active, 2, "A has 2 in flight");
  assert.equal(__peek(B).active, 0, "B is untouched by A's traffic");
  releaseSlot(A);
  releaseSlot(A);
  assert.equal(__peek(A).active, 0);

  // --- THE ISOLATION GUARANTEE: a 429 for one client must NOT freeze the others.
  // This is the bug the old process-wide cooldownUntil would have caused.
  note429(A, 10_000);
  assert.ok(__peek(A).cooldownUntil > Date.now(), "A is cooling down");
  assert.equal(__peek(B).cooldownUntil, 0, "B must NOT be cooling down");

  // --- A's concurrency cap must not starve B: saturate A, then B still admits.
  __resetLimiters();
  for (let i = 0; i < 8; i++) await acquireSlot(A); // 8 = MAX_CONCURRENT
  assert.equal(__peek(A).active, 8, "A is at its cap");

  let bAdmitted = false;
  await Promise.race([
    acquireSlot(B).then(() => {
      bAdmitted = true;
    }),
    new Promise((r) => setTimeout(r, 250)),
  ]);
  assert.ok(bAdmitted, "B must be admitted immediately even while A is saturated");

  // --- a 9th request for A queues rather than over-admitting
  let aOverAdmitted = false;
  void acquireSlot(A).then(() => {
    aOverAdmitted = true;
  });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(aOverAdmitted, false, "A's 9th request must queue");
  assert.equal(__peek(A).active, 8, "A must never exceed its cap");

  // --- releasing hands the slot to the waiter
  releaseSlot(A);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(aOverAdmitted, "the queued request must be admitted on release");
  assert.equal(__peek(A).active, 8, "active count stays pinned at the cap on handoff");

  // --- backoff policy: an upstream Retry-After must never park the sync
  //
  // Regression guard. GHL returned `522 Retry-After: 120` and the client obeyed it
  // verbatim, so every parallel dataset fetch slept two minutes while the loading
  // screen sat at 0% with no sub-account name — indistinguishable from a hang.
  // A 5xx is a broken gateway, not a rate limit: it does not get to choose how
  // long we wait.

  // no Retry-After → plain exponential backoff
  assert.equal(serverErrorDelayMs(0, 0, 0), 1000, "attempt 0 backs off 1s");
  assert.equal(serverErrorDelayMs(0, 3, 0), 8000, "attempt 3 backs off 8s");
  assert.equal(serverErrorDelayMs(0, 2, 300), 4300, "jitter is added to the exponential");

  // a short Retry-After is still honoured
  assert.equal(serverErrorDelayMs(5, 0, 0), 5000, "a short Retry-After is respected");

  // THE BUG: a long Retry-After is capped
  assert.equal(serverErrorDelayMs(120, 0, 0), MAX_SERVER_BACKOFF_MS, "Retry-After: 120 must be capped");
  assert.equal(serverErrorDelayMs(3600, 0, 0), MAX_SERVER_BACKOFF_MS, "an absurd Retry-After must be capped");
  assert.ok(MAX_SERVER_BACKOFF_MS <= 15_000, "the cap must keep a stalled sync recoverable");

  // Attempt 3 is the last one that actually sleeps — ghlFetch throws at
  // attempt === MAX_RETRIES (4) before reaching the backoff — so in practice the
  // exponential path never reaches the cap and the cap only ever constrains a
  // server-supplied Retry-After.
  assert.ok(serverErrorDelayMs(0, 3, 500) < MAX_SERVER_BACKOFF_MS, "the last sleeping attempt stays under the cap");

  // --- 429 cooldown: same defect one branch away
  assert.equal(rateLimitCooldownMs(0, 10_000), 10_000, "no Retry-After → the rate-limit window");
  assert.equal(rateLimitCooldownMs(5, 10_000), 5000, "a short Retry-After is respected");
  assert.equal(rateLimitCooldownMs(3600, 10_000), MAX_429_COOLDOWN_MS, "an hour-long cooldown must be capped");

  console.log("✅ lib/ghl-limiter.ts — all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
