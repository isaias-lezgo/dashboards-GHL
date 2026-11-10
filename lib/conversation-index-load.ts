// Server-only: walks GHL conversations for the conversation index (spec
// 2026-11-02 §3.8). Shared by app/api/conversation-index (the panel) and
// scripts/check-vaeo-reference.ts (the reference check) so both read the same
// rows. Must run inside withClient(): ghlFetch takes the token from the context.
//
// Ported from DASHBOARDS_VAEO/app/api/conversation-activity: walk conversations
// newest-first by cursor until the window ends; a conversation ending OUTBOUND
// already carries our last outbound date, so only threads ending inbound inside
// the window are opened (measured on VAEO: ~93% need no extra call).
import { getMessages, getUsers, searchConversationsPage, type GHLConversationSearchDoc } from "@/lib/ghl-client";
import { channelLabel, lastOutboundFrom, needsThread, toIso, type ConversationRow } from "@/lib/conversation-index";

const PAGE_SIZE = 100;
/** A runaway guard, not a limit: 2000 pages = 200 000 conversations. Hitting it marks the result truncated. */
const MAX_PAGES = 2000;
/** Same as dashboard-messages: never hundreds of threads at once against one location's budget. */
const CONCURRENCY = 6;

export interface ConversationIndexLoad {
  rows: ConversationRow[];
  from: string;
  truncated: boolean;
  threadErrors: number;
}

export async function loadConversationIndex(
  days: number,
  onProgress: (p: { scanned: number; threads: number; message: string }) => void = () => {}
): Promise<ConversationIndexLoad> {
  const cutoff = Date.now() - days * 86_400_000;

  const usersRaw = await getUsers().catch(() => ({ users: [] }));
  const userName = new Map<string, string>();
  for (const u of usersRaw.users) userName.set(u.id, u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim());

  // 1. Walk conversations newest-first until the window ends. A failed page
  //    THROWS: a partial walk would push real contacts into "más de N días o
  //    sin mensajes" — an accusation, not a gap.
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
    onProgress({ scanned: rows.length, threads: 0, message: `Conversaciones revisadas: ${rows.length.toLocaleString("es-MX")}` });
    const next = docs[docs.length - 1]?.sort?.[0];
    if (next === undefined || docs.length < PAGE_SIZE) break;
    cursor = next;
  }

  // 2. Open only the threads that end inbound inside the window. A thread that
  //    fails keeps lastOutboundAt null and is counted, so the card can say some
  //    dates may be more recent than shown.
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
          onProgress({ scanned: rows.length, threads: done, message: `Sin respuesta revisadas: ${done} de ${pending.length}` });
        }
      }
    })
  );

  return { rows, from: new Date(cutoff).toISOString(), truncated, threadErrors };
}
