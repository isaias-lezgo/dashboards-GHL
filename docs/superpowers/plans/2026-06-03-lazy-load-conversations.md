# Lazy-load Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the expensive per-user conversation + message fan-out off the initial dashboard load so the UI paints from core data immediately and conversations stream in silently in the background.

**Architecture:** Extract the conversation block from `/api/dashboard` into a dedicated streaming `/api/conversations` route. On the client, a new `useConversationsData` hook fires on mount alongside `useDashboardData`, and `app/page.tsx` merges the two. Message-dependent Sales UI shows an inline loading state until the background fetch lands.

**Tech Stack:** Next.js 15 App Router, ReadableStream NDJSON, React hooks. No test framework exists in this repo (`CLAUDE.md`: "There are no automated tests"), so each task verifies with `npm run build`, `npm run lint`, and a manual browser check rather than unit tests.

---

## File Structure

- **Create** `hooks/fetch-stream.ts` — shared NDJSON stream reader, generic over payload type. Lifted verbatim from `use-dashboard-data.ts`.
- **Create** `app/api/conversations/route.ts` — streaming GET that does the per-user conversation/message fan-out and emits `{ type: "data", messages, meta }`.
- **Create** `hooks/use-conversations-data.ts` — client hook fetching `/api/conversations` via the shared reader; exposes `{ messages, isLoading, isError }`.
- **Modify** `app/api/dashboard/route.ts` — delete the conversation block (lines ~353-429); drop `messages` + `totalMessages` from the `data` event.
- **Modify** `hooks/use-dashboard-data.ts` — use the shared `fetchStream`; drop `messages`/`totalMessages` from `DashboardData`.
- **Modify** `app/page.tsx` — call `useConversationsData()`; source `messages` from it; pass `messagesLoading` to Sales.
- **Modify** `components/dashboard/sales-dashboard.tsx` — accept optional `messagesLoading` prop; show inline "Cargando conversaciones…" on the conversations badge.

---

## Task 1: Extract shared stream reader

**Files:**
- Create: `hooks/fetch-stream.ts`
- Modify: `hooks/use-dashboard-data.ts:37-80` (remove local `fetchStream`), `hooks/use-dashboard-data.ts:111` (call shared one)

- [ ] **Step 1: Create the shared generic reader**

Create `hooks/fetch-stream.ts`:

```ts
"use client";

/**
 * Reads an NDJSON stream of `{ type: "progress" | "data" | "error", ... }`
 * frames. Calls `onProgress` for progress frames and resolves with the payload
 * of the single `data` frame (its `type` field stripped).
 */
export async function fetchStream<T>(
  url: string,
  onProgress: (message: string) => void,
  signal: AbortSignal
): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: T | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "progress") {
          onProgress(msg.message);
        } else if (msg.type === "data") {
          const { type: _t, ...rest } = msg;
          data = rest as T;
        } else if (msg.type === "error") {
          throw new Error(msg.message || "Stream error");
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  if (!data) throw new Error("No data received from stream");
  return data;
}
```

- [ ] **Step 2: Point `use-dashboard-data.ts` at the shared reader**

In `hooks/use-dashboard-data.ts`, delete the entire local `async function fetchStream(...) { ... }` block (lines 37-80) and add an import at the top (after the `import type { ... } from "@/lib/types";` block):

```ts
import { fetchStream } from "./fetch-stream";
```

Then change the call site (was line 111) to type the generic:

```ts
      const result = await fetchStream<DashboardData>(url, setProgress, ctrl.signal);
```

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, no new lint errors. (TypeScript errors are ignored in build per `next.config.mjs`, so also eyeball that `fetchStream` is imported, not duplicated.)

- [ ] **Step 4: Commit**

```bash
git add hooks/fetch-stream.ts hooks/use-dashboard-data.ts
git commit -m "refactor: extract shared fetchStream NDJSON reader"
```

---

## Task 2: Create the `/api/conversations` route

**Files:**
- Create: `app/api/conversations/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/conversations/route.ts`. It rebuilds `userMap` from `getUsers()` (needed for advisor name attribution) then runs the same fan-out the dashboard route used.

```ts
import {
  getConversations,
  getMessages,
  getUsers,
  type GHLConversation,
} from "@/lib/ghl-client";
import { ghlMessageToInternal } from "@/lib/ghl-message-mapper";
import type { Message } from "@/lib/types";

function enc(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(enc(obj)));
      };

      try {
        send({ type: "progress", message: "Cargando asesores…" });

        // Build user lookup map for advisor attribution.
        const usersRaw = await getUsers().catch(() => ({ users: [] }));
        const userMap = new Map<string, string>();
        for (const u of usersRaw.users) {
          const name = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim();
          userMap.set(u.id, name);
        }

        // Fetch last 30 active conversations PER user (not 30 in total),
        // so every advisor with activity shows up in the conversation charts.
        send({ type: "progress", message: "Cargando conversaciones…" });
        const messages: Message[] = [];
        try {
          const userIds = Array.from(userMap.keys());

          // Bounded concurrency — avoid firing all user-conversation queries
          // simultaneously, which exhausts the GHL rate-limit budget.
          const CONCURRENCY_CONV = 4;
          let convFetchCursor = 0;
          const userConvResults: Array<{ userId: string; conversations: GHLConversation[] }> = [];
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY_CONV, userIds.length) }, async () => {
              while (convFetchCursor < userIds.length) {
                const idx = convFetchCursor++;
                const userId = userIds[idx];
                try {
                  const resp = await getConversations({ limit: 30, assignedTo: userId });
                  userConvResults.push({ userId, conversations: resp.conversations });
                } catch {
                  userConvResults.push({ userId, conversations: [] });
                }
              }
            })
          );

          // Dedupe conversations across users (a conv reassigned mid-stream
          // could surface under multiple users) and remember which user we
          // queried for, so we can attribute messages even if conv.assignedTo
          // is missing from the GHL payload. Skip deleted conversations.
          const convQueue: Array<{ conv: GHLConversation; queriedUserId: string }> = [];
          const seenConvIds = new Set<string>();
          for (const { userId, conversations } of userConvResults) {
            for (const conv of conversations) {
              if (seenConvIds.has(conv.id)) continue;
              if (conv.deleted) continue;
              seenConvIds.add(conv.id);
              convQueue.push({ conv, queriedUserId: userId });
            }
          }

          // Bounded-concurrency message fetches so a 100+-conversation queue
          // doesn't fan out to hundreds of simultaneous requests.
          const CONCURRENCY = 6;
          let cursor = 0;
          const collected: Message[][] = new Array(convQueue.length);
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, convQueue.length) }, async () => {
              while (cursor < convQueue.length) {
                const idx = cursor++;
                const { conv, queriedUserId } = convQueue[idx];
                const advisorId = conv.assignedTo ?? queriedUserId;
                const advisorName = userMap.get(advisorId) ?? advisorId;
                try {
                  const msgResp = await getMessages(conv.id, { limit: 50 });
                  const out: Message[] = [];
                  for (const msg of msgResp.messages.messages) {
                    const transformed = ghlMessageToInternal(msg, conv.contactId, {
                      conversationId: conv.id,
                      assignedTo: advisorName,
                    });
                    if (transformed) out.push(transformed);
                  }
                  collected[idx] = out;
                } catch {
                  collected[idx] = [];
                }
              }
            })
          );
          for (const batch of collected) {
            if (batch) messages.push(...batch);
          }
        } catch (err) {
          console.error("[GHL] Conversations fetch failed:", err);
        }

        send({
          type: "data",
          messages,
          meta: {
            totalMessages: messages.length,
            fetchedAt: new Date().toISOString(),
          },
        });
        controller.close();
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: build succeeds; the new route compiles.

- [ ] **Step 3: Verify the endpoint streams data**

Start the dev server (`npm run dev`) if not running, then:

Run: `curl -sN http://localhost:3000/api/conversations | tail -n 1 | head -c 200`
Expected: a JSON line beginning `{"type":"data","messages":[` (or `[]` if the location genuinely has no recent conversations). Confirms the route fans out and returns the `data` frame.

- [ ] **Step 4: Commit**

```bash
git add app/api/conversations/route.ts
git commit -m "feat: add /api/conversations streaming route"
```

---

## Task 3: Remove conversations from the dashboard route

**Files:**
- Modify: `app/api/dashboard/route.ts:353-429` (delete conversation block), `:355` progress message, `:533` data field, `:545` meta field, imports at `:5-6`

- [ ] **Step 1: Delete the conversation block**

In `app/api/dashboard/route.ts`, delete the whole block from the comment `// Fetch last 30 active conversations PER user...` through its closing `catch`/`}` — i.e. remove lines 353-429 (the `send({ type: "progress", message: "Cargando conversaciones…" })` line, `const messages: Message[] = []`, the two fan-out loops, and the trailing `catch (err) { console.error("[GHL] Conversations fetch failed:", err); }`).

- [ ] **Step 2: Drop `messages` from the `data` event**

In the `send({ type: "data", ... })` object (was ~line 527), remove the `messages,` line (was line 533) and remove the `totalMessages: messages.length,` line from `meta` (was line 545).

- [ ] **Step 3: Drop now-unused imports**

In the import block at the top (`app/api/dashboard/route.ts:1-18`), remove `getConversations,` (line 5) and `getMessages,` (line 6). Leave `getUsers`. Also remove the `ghlMessageToInternal` import (line 18) and the `Message` type from the `@/lib/types` import (line 24) **only if** they are no longer referenced anywhere else in the file.

- [ ] **Step 4: Confirm no dangling references**

Run: `grep -n "messages\|getConversations\|getMessages\|ghlMessageToInternal\|GHLConversation" app/api/dashboard/route.ts`
Expected: no matches (or only matches in unrelated comments). If `GHLConversation` is still imported at line 14, remove it too.

- [ ] **Step 5: Verify build + endpoint**

Run: `npm run build`
Expected: build succeeds.

Run: `curl -sN http://localhost:3000/api/dashboard | tail -n 1 | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('messages' in d, d.get('meta',{}).get('totalMessages'))"`
Expected: prints `False None` — confirms the dashboard payload no longer carries messages.

- [ ] **Step 6: Commit**

```bash
git add app/api/dashboard/route.ts
git commit -m "feat: move conversation fan-out out of dashboard route"
```

---

## Task 4: Trim `DashboardData` and add `useConversationsData`

**Files:**
- Modify: `hooks/use-dashboard-data.ts:20,32` (drop `messages`, `totalMessages`)
- Create: `hooks/use-conversations-data.ts`

- [ ] **Step 1: Drop messages from `DashboardData`**

In `hooks/use-dashboard-data.ts`, remove `messages: Message[];` (line 20) from the `DashboardData` interface and `totalMessages: number;` (line 32) from its `meta`. Remove the now-unused `Message` import from the `@/lib/types` import block (lines 4-13).

- [ ] **Step 2: Create the conversations hook**

Create `hooks/use-conversations-data.ts`:

```ts
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Message } from "@/lib/types";
import { fetchStream } from "./fetch-stream";

interface ConversationsPayload {
  messages: Message[];
  meta: { totalMessages: number; fetchedAt: string };
}

/**
 * Fetches conversation messages from /api/conversations on mount, independent of
 * the main dashboard load. This keeps the expensive per-user message fan-out off
 * the critical path: the dashboard paints first, messages stream in after.
 */
export function useConversationsData() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setIsLoading(true);
    setIsError(false);

    try {
      const result = await fetchStream<ConversationsPayload>(
        "/api/conversations",
        () => {},
        ctrl.signal
      );
      setMessages(result.messages);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setIsError(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const refresh = useCallback(() => {
    load();
  }, [load]);

  return { messages, isLoading, isError, refresh };
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-dashboard-data.ts hooks/use-conversations-data.ts
git commit -m "feat: add useConversationsData hook, drop messages from dashboard data"
```

---

## Task 5: Wire the hook into the page

**Files:**
- Modify: `app/page.tsx:11` (import), `:46-51` (hook calls + messages source), `:218` and `:233`/`:254` (props)

- [ ] **Step 1: Import the hook**

In `app/page.tsx`, after the `useDashboardData` import (line 11), add:

```ts
import { useConversationsData } from "@/hooks/use-conversations-data"
```

- [ ] **Step 2: Call the hook and source messages from it**

Replace the line `const messages = data?.messages ?? []` (line 51) — note `data.messages` no longer exists. After the existing `const { data, isLoading, isError, progress, refresh } = useDashboardData({})` (line 46), add:

```ts
  const { messages, isLoading: messagesLoading } = useConversationsData()
```

and delete the old `const messages = data?.messages ?? []` line.

- [ ] **Step 3: Pass `messagesLoading` to the Sales dashboard**

In the `<SalesDashboard ... />` JSX (around line 214-225), add the prop alongside `messages={messages}`:

```tsx
            messages={messages}
            messagesLoading={messagesLoading}
```

(The `ConversationsChat` and `AIChatPanel` dataset props keep passing `messages` as-is — they populate a beat later with no code change.)

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, no new lint errors.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: fetch conversations via background hook on dashboard page"
```

---

## Task 6: Inline loading state on Sales message UI

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx:52-63` (props), `:178` (destructure), `:1086` (badge)

- [ ] **Step 1: Add the prop to the interface**

In `components/dashboard/sales-dashboard.tsx`, add to `SalesDashboardProps` (after `messages: Message[]`, line 56):

```ts
  messagesLoading?: boolean
```

- [ ] **Step 2: Destructure it with a default**

In the `export function SalesDashboard({ ... })` signature (line 178), add `messagesLoading = false,` to the destructured params (e.g. right after `messages = [],`).

- [ ] **Step 3: Show loading on the conversations badge**

At the conversations total badge (line 1086):

```tsx
          <TotalBadge value={new Set(messages.map((m) => m.conversationId).filter(Boolean)).size} />
```

replace with a loading-aware version:

```tsx
          {messagesLoading && messages.length === 0 ? (
            <span className="text-xs text-muted-foreground">Cargando conversaciones…</span>
          ) : (
            <TotalBadge value={new Set(messages.map((m) => m.conversationId).filter(Boolean)).size} />
          )}
```

- [ ] **Step 4: Verify build + manual check**

Run: `npm run build`
Expected: build succeeds.

Manual: with `npm run dev` running, hard-reload the app, immediately click the **Ventas** tab. Expected: conversation panels show "Cargando conversaciones…" briefly, then populate without a full-page reload. The **Marketing** tab paints with no conversation wait.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat: inline loading state for Sales conversation panels"
```

---

## Self-Review Notes

- **Spec coverage:** new `/api/conversations` route (Task 2), dashboard route trimmed (Task 3), shared `fetchStream` (Task 1), `DashboardData` trimmed + new hook (Task 4), page wiring with background fire-on-mount (Task 5), inline loading UX (Task 6). All spec sections mapped.
- **Type consistency:** `fetchStream<T>` generic used by both hooks; `ConversationsPayload` matches the route's `data` frame (`messages`, `meta.totalMessages`, `meta.fetchedAt`); `messagesLoading` named identically in page and Sales props.
- **No test framework:** verification uses `npm run build`, `npm run lint`, `curl`, and manual browser checks by design — consistent with repo conventions.
