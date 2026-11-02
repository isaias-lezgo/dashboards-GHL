// The conversation index for the AI panel (spec 2026-11-02 §3.8): every
// conversation with activity in the last N days, and our last outbound message
// in each. Read-only, streamed as NDJSON like dashboard-messages, loaded only
// when a panel card (or the copilot) needs conversations.
//
// Ported from DASHBOARDS_VAEO/app/api/conversation-activity: walk conversations
// newest-first by cursor until the window ends; a conversation ending OUTBOUND
// already carries our last outbound date, so only threads ending inbound inside
// the window are opened (measured on VAEO: ~93% need no extra call).
import { getMessages, getUsers, searchConversationsPage, type GHLConversationSearchDoc } from "@/lib/ghl-client";
import { channelLabel, lastOutboundFrom, needsThread, toIso, type ConversationRow } from "@/lib/conversation-index";
import { requireClient, unauthorized } from "@/lib/session";
import { withClient } from "@/lib/ghl-context";

export const runtime = "nodejs";
// VAEO measured ~90 s for 60 days of a busy account; a wider window is the
// user's explicit choice and the card warns about the wait.
export const maxDuration = 300;

const DEFAULT_DAYS = 60;
const PAGE_SIZE = 100;
/** A runaway guard, not a limit: 2000 pages = 200 000 conversations. Hitting it marks the result truncated. */
const MAX_PAGES = 2000;
/** Same as dashboard-messages: never hundreds of threads at once against one location's budget. */
const CONCURRENCY = 6;

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
          const started = Date.now();
          const cutoff = started - days * 86_400_000;

          const usersRaw = await getUsers().catch(() => ({ users: [] }));
          const userName = new Map<string, string>();
          for (const u of usersRaw.users) userName.set(u.id, u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim());

          // 1. Walk conversations newest-first until the window ends. A failed
          //    page fails the load: a partial walk would push real contacts into
          //    "más de N días o sin mensajes" — an accusation, not a gap.
          const rows: ConversationRow[] = [];
          const seen = new Set<string>();
          let cursor: number | string | undefined;
          let truncated = false;
          let ended = false;
          for (let page = 0; !ended; page++) {
            if (page >= MAX_PAGES) {
              truncated = true;
              break;
            }
            const docs: GHLConversationSearchDoc[] = (await searchConversationsPage({ limit: PAGE_SIZE, startAfterDate: cursor })).conversations;
            if (docs.length === 0) break;
            for (const c of docs) {
              if (seen.has(c.id)) continue;
              seen.add(c.id);
              if (c.deleted || !c.contactId) continue;
              const lastMessageAt = toIso(c.lastMessageDate);
              if (!lastMessageAt) continue;
              if (new Date(lastMessageAt).getTime() < cutoff) {
                ended = true;
                continue;
              }
              const lastDirection = c.lastMessageDirection ?? null;
              rows.push({
                id: c.id,
                contactId: c.contactId,
                channel: channelLabel(c.lastMessageType),
                assignedTo: c.assignedTo ? (userName.get(c.assignedTo) ?? null) : null,
                lastMessageAt,
                lastDirection,
                unreadCount: c.unreadCount ?? 0,
                createdAt: toIso(c.dateAdded),
                lastOutboundAt: lastDirection === "outbound" ? lastMessageAt : null,
                waitingReply: lastDirection === "inbound",
              });
            }
            send({ type: "progress", scanned: rows.length, threads: 0, message: `Conversaciones revisadas: ${rows.length.toLocaleString("es-MX")}` });
            const next = docs[docs.length - 1]?.sort?.[0];
            if (next === undefined || docs.length < PAGE_SIZE) break;
            cursor = next;
          }

          // 2. Open only the threads that end inbound inside the window. A thread
          //    that fails keeps lastOutboundAt null and is counted, so the card
          //    can say some dates may be more recent than shown.
          const pending = rows.filter((r) => needsThread(r.lastDirection, r.lastMessageAt, cutoff));
          let idx = 0;
          let done = 0;
          let threadErrors = 0;
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
              while (idx < pending.length) {
                const row = pending[idx++];
                try {
                  const res = await getMessages(row.id, { limit: 50 });
                  row.lastOutboundAt = lastOutboundFrom(res.messages.messages);
                } catch {
                  threadErrors++;
                }
                done++;
                if (done % 10 === 0 || done === pending.length) {
                  send({ type: "progress", scanned: rows.length, threads: done, message: `Sin respuesta revisadas: ${done} de ${pending.length}` });
                }
              }
            })
          );

          send({ type: "data", rows, days, from: new Date(cutoff).toISOString(), truncated, threadErrors });
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
