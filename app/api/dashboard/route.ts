// The dashboard's main sync route.
//
// The orchestration that used to live here now sits in lib/sync.ts, because the
// background refresh has to run the SAME code this route runs. What is left is
// the decision: serve the cache, or go to GHL.
//
//   GET /api/dashboard
//       ↓  requireClient()           → resolves the cookie to a ClientConfig
//       ↓  readCache(client)         → the project_sync row
//       ├─ hit  → ship the payload immediately; if it is older than the fresh
//       │         window, after(() => refresh) once the response has gone out
//       └─ miss → live sync with the loading screen, then cache the result
//
// ?fresh=1 skips the cache entirely — that is what the "Actualizar" button sends.
import { after } from "next/server";
import { requireClient, unauthorized } from "@/lib/session";
import { syncProject } from "@/lib/sync";
import { isDbConfigured } from "@/lib/db";
import { readSync, writeSync, claimSync, releaseSync, isStale } from "@/lib/sync-store";
import type { ClientConfig } from "@/lib/clients";
import type { DashboardPayload } from "@/lib/types";

export const runtime = "nodejs";

// A full cold sync was measured at 34s once and 60.3s half an hour later on the
// same data — GHL's response time varies by nearly 2x. The 300s ceiling requires
// Fluid Compute to be ON (Settings → Functions); it is NOT a paid-plan feature.
// With Fluid off the ceiling is 60s and the failure is silent: the background
// refresh gets cut mid-flight, long after the response was already sent, so the
// only symptom is "Actualizado hace X" that stops advancing.
export const maxDuration = 300;

function enc(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

// The database is an ACCELERATOR, never a dependency. Every failure below is
// logged and degrades to a live sync against GHL. Adding the cache must not
// create a new way for the dashboard to fail to load — verify by pointing
// DATABASE_URL at an invalid host and confirming the app still works.
async function readCache(
  client: ClientConfig,
): Promise<{ payload: DashboardPayload; syncedAt: string } | null> {
  if (!isDbConfigured()) return null;
  try {
    return await readSync(client);
  } catch (err) {
    console.error("[cache] read failed, falling back to a live sync:", err);
    return null;
  }
}

async function saveQuietly(client: ClientConfig, payload: DashboardPayload): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await writeSync(client, payload);
  } catch (err) {
    console.error("[cache] write failed; the payload was still served:", err);
  }
}

// Runs after the response has been sent. The lock is what makes two people
// opening the same stale client at once produce ONE sync instead of two.
async function refreshInBackground(client: ClientConfig): Promise<void> {
  if (!isDbConfigured()) return;
  let claimed = false;
  try {
    claimed = await claimSync(client);
    if (!claimed) {
      // Someone else already holds the lock. Logged rather than silent: this is
      // the only externally visible sign that the lock is doing its job.
      console.log(`[cache] refresh skipped for ${client.id} — another sync holds the lock`);
      return;
    }
    console.log(`[cache] background refresh started for ${client.id}`);
    const payload = await syncProject(client);
    // writeSync clears sync_started_at itself, so the happy path needs no release.
    await writeSync(client, payload);
    console.log(`[cache] background refresh done for ${client.id}`);
  } catch (err) {
    console.error("[cache] background refresh failed:", err);
    if (claimed) {
      // Release WITHOUT touching the payload: a failed refresh must leave the
      // last good cache in place. An hour-old dashboard beats no dashboard.
      try {
        await releaseSync(client, err instanceof Error ? err.message : String(err));
      } catch (releaseErr) {
        console.error("[cache] releasing the lock failed too:", releaseErr);
      }
    }
  }
}

export async function GET(request: Request) {
  // Resolve the client here, in the request scope — cookies() is unavailable
  // both inside the stream callback below and inside after().
  const client = await requireClient();
  if (!client) return unauthorized();

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const cached = fresh ? null : await readCache(client);

  // Scheduled from the handler scope, not from inside the stream: after() belongs
  // to the request, and without it the function is torn down when the response
  // closes and the refresh would simply never run.
  if (cached && isStale(cached.syncedAt)) {
    after(() => refreshInBackground(client));
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(enc(obj)));
      };

      try {
        if (cached) {
          // Hot path: one frame, no progress, no GHL. The hook has to avoid
          // flashing the loading screen for this.
          send({ type: "data", ...cached.payload, syncedAt: cached.syncedAt });
          return;
        }

        // Cold path: never synced, ?fresh=1, or the database did not answer.
        // syncProject enters the credential context itself — and it does so
        // inside this start() callback, because the stream keeps producing
        // frames after GET() has already returned.
        const payload = await syncProject(client, (frame) => send(frame));
        send({ type: "data", ...payload, syncedAt: payload.meta.fetchedAt });
        await saveQuietly(client, payload);
      } catch (error) {
        console.error("[GHL Dashboard API Error]", error);
        send({
          type: "error",
          error: "Failed to fetch dashboard data",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
