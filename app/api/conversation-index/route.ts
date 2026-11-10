// The conversation index for the AI panel (spec 2026-11-02 §3.8): every
// conversation with activity in the last N days, and our last outbound message
// in each. Read-only, streamed as NDJSON like dashboard-messages, loaded only
// when a panel card (or the copilot) needs conversations. The walk itself is
// lib/conversation-index-load.ts.
import { loadConversationIndex } from "@/lib/conversation-index-load";
import { requireClient, unauthorized } from "@/lib/session";
import { withClient } from "@/lib/ghl-context";

export const runtime = "nodejs";
// VAEO measured ~90 s for 60 days of a busy account; a wider window is the
// user's explicit choice and the card warns about the wait.
export const maxDuration = 300;

const DEFAULT_DAYS = 60;

function enc(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

function daysParam(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_DAYS;
}

export async function GET(req: Request) {
  // Resolve the client in the request scope — cookies() is unavailable inside
  // the stream callback below.
  const client = await requireClient();
  if (!client) return unauthorized();
  const days = daysParam(new URL(req.url).searchParams.get("days"));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Context entered HERE, not around GET(): the stream outlives the
      // handler's return.
      await withClient(client, async () => {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(enc(obj)));
        try {
          const res = await loadConversationIndex(days, (p) => send({ type: "progress", ...p }));
          send({ type: "data", days, ...res });
        } catch (err) {
          send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          controller.close();
        }
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
}
