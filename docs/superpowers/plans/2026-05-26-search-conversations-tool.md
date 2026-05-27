# search_conversations AI Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `search_conversations` AI tool that fetches full conversation threads for an arbitrary list of contactIds in parallel, enabling the AI to answer bulk conversation queries derived from any other tool.

**Architecture:** Three file changes, no new files. The existing `/api/conversations` route is parallelized (batched `Promise.all`) and gains a `messageLimit` param. A new `fetchConversationThreads` async handler in the chat panel mirrors the existing `fetchContactMessages` pattern. The tool schema is added to `TOOL_DEFINITIONS` as a server-side tool (no client-side executor).

**Tech Stack:** Next.js 15 App Router, TypeScript, GHL REST API (`getConversations`, `getMessages`)

---

## File Map

| File | Change |
|---|---|
| `app/api/conversations/route.ts` | Replace serial `for` loop with batched `Promise.all`; add `messageLimit` query param |
| `lib/ai-tools.ts` | Add `search_conversations` entry to `TOOL_DEFINITIONS` array |
| `components/dashboard/ai-chat-panel.tsx` | Add `fetchConversationThreads` function; add `search_conversations` routing case |

---

### Task 1: Parallelize `/api/conversations` and add `messageLimit`

**Files:**
- Modify: `app/api/conversations/route.ts`

The current implementation fetches one contact at a time in a serial `for` loop. This task replaces it with batched `Promise.all` (10 contacts per batch) and adds a `messageLimit` query param so callers can control how many messages per thread to fetch.

- [ ] **Step 1: Replace the entire route file**

Replace the full contents of `app/api/conversations/route.ts` with:

```typescript
import { getConversations, getMessages } from "@/lib/ghl-client"
import { ghlMessageToInternal } from "@/lib/ghl-message-mapper"
import type { Message } from "@/lib/types"

const BATCH_SIZE = 10

async function fetchThread(
  contactId: string,
  messageLimit: number
): Promise<{ contactId: string; messages: Message[] }> {
  try {
    const convResp = await getConversations({ contactId, limit: 1 })
    const conv = convResp.conversations[0]
    if (!conv) return { contactId, messages: [] }
    const msgResp = await getMessages(conv.id, { limit: messageLimit })
    const messages: Message[] = msgResp.messages.messages
      .map((m) => ghlMessageToInternal(m, contactId))
      .filter((m): m is Message => m !== null)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    return { contactId, messages }
  } catch (err) {
    console.warn(`[conversations] Failed to fetch thread for contact ${contactId}:`, err)
    return { contactId, messages: [] }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const contactIds = (searchParams.get("contactIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  const rawLimit = parseInt(searchParams.get("messageLimit") ?? "100", 10)
  const messageLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100

  const locationId = process.env.GHL_LOCATION_ID ?? ""

  if (contactIds.length === 0) {
    return Response.json({ threads: [], locationId })
  }

  const threads: Array<{ contactId: string; messages: Message[] }> = []

  for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
    const batch = contactIds.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map((id) => fetchThread(id, messageLimit)))
    threads.push(...results)
  }

  return Response.json({ threads, locationId })
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes, route listed as `ƒ /api/conversations`.

- [ ] **Step 3: Commit**

```bash
git add app/api/conversations/route.ts
git commit -m "feat(api): parallelize conversations route with batched Promise.all, add messageLimit param"
```

---

### Task 2: Add `search_conversations` to `TOOL_DEFINITIONS`

**Files:**
- Modify: `lib/ai-tools.ts` (after the `export_csv` definition, before `] as const`)

The tool is server-side — the AI dispatches it, the chat panel handles it via `fetchConversationThreads`. No entry in `executeTool` is needed.

- [ ] **Step 1: Add the tool definition**

In `lib/ai-tools.ts`, find the closing of the `export_csv` definition block (the `},` before `] as const`). Insert the following new entry between `export_csv` and `] as const`:

```typescript
  {
    name: "search_conversations",
    description:
      "Fetches full conversation message threads for a list of contacts from GoHighLevel. Always derive contactIds first using list_appointments, search_contacts, search_opportunities, or other tools — never ask the user for IDs. May take several seconds for large batches. Returns full message history per contact (newest first), content truncated to 500 chars. For a single contact's conversation, use get_contact_messages instead.",
    input_schema: {
      type: "object",
      properties: {
        contactIds: {
          type: "array",
          items: { type: "string" },
          description:
            "List of contact IDs to fetch conversation threads for. Derive these from other tool calls such as list_appointments, search_contacts, or search_opportunities.",
        },
        limit: {
          type: "number",
          description: "Max number of contacts to process (default 20, max 50).",
        },
        messageLimit: {
          type: "number",
          description: "Max messages to return per thread (default 100).",
        },
      },
      required: ["contactIds"],
    },
  },
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat(ai): add search_conversations tool definition"
```

---

### Task 3: Add `fetchConversationThreads` handler and routing in chat panel

**Files:**
- Modify: `components/dashboard/ai-chat-panel.tsx`

Two changes in this file:
1. Add `fetchConversationThreads` async function after `fetchContactMessages` (~line 137)
2. Add a routing case for `"search_conversations"` in the tool dispatch block (~line 251)

- [ ] **Step 1: Add `fetchConversationThreads` after `fetchContactMessages`**

In `ai-chat-panel.tsx`, find the closing brace of `fetchContactMessages` (the `}` on the line after the `return { contactId, returned: ... }` block, around line 137). Insert immediately after it:

```typescript
async function fetchConversationThreads(input: Record<string, unknown>): Promise<unknown> {
  const rawIds = Array.isArray(input.contactIds) ? (input.contactIds as string[]) : []
  if (rawIds.length === 0) {
    return { error: "contactIds is required and must be a non-empty array" }
  }

  const limit = typeof input.limit === "number"
    ? Math.min(50, Math.max(1, Math.floor(input.limit)))
    : 20
  const messageLimit = typeof input.messageLimit === "number"
    ? Math.max(1, Math.floor(input.messageLimit))
    : 100
  const contactIds = rawIds.slice(0, limit)

  const params = new URLSearchParams({
    contactIds: contactIds.join(","),
    messageLimit: String(messageLimit),
  })

  const res = await fetch(`/api/conversations?${params}`, { method: "GET" })
  if (!res.ok) {
    return { error: `GHL fetch failed (HTTP ${res.status})` }
  }

  const data = (await res.json()) as {
    threads: Array<{ contactId: string; messages: Array<Record<string, unknown>> }>
  }

  const threads = (data.threads ?? []).map((t) => {
    const sorted = [...t.messages].sort(
      (a, b) =>
        new Date(String(b.createdAt ?? "")).getTime() -
        new Date(String(a.createdAt ?? "")).getTime()
    )
    return {
      contactId: t.contactId,
      messageCount: t.messages.length,
      messages: sorted.map((m) => ({
        id: m.id,
        direction: m.direction,
        source: m.source,
        content:
          typeof m.content === "string" && m.content.length > 500
            ? m.content.slice(0, 500) + "…"
            : m.content,
        createdAt: m.createdAt,
      })),
    }
  })

  return { returned: threads.length, threads }
}
```

- [ ] **Step 2: Add routing case for `search_conversations`**

In `ai-chat-panel.tsx`, find the tool dispatch block. It currently reads:

```typescript
if (tu.name === "get_contact_messages") {
  result = await fetchContactMessages(tu.input);
} else if (tu.name === "export_csv") {
```

Change it to:

```typescript
if (tu.name === "get_contact_messages") {
  result = await fetchContactMessages(tu.input);
} else if (tu.name === "search_conversations") {
  result = await fetchConversationThreads(tu.input);
} else if (tu.name === "export_csv") {
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes without errors.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/ai-chat-panel.tsx
git commit -m "feat(ai): add fetchConversationThreads handler and search_conversations routing"
```

---

### Task 4: Verify in the browser

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://localhost:3000` and open the AI chat panel (the sparkle/AI button).

- [ ] **Step 2: Test the tool end-to-end**

Ask the AI:

> "Muéstrame las conversaciones de los contactos con citas esta semana"

Expected behavior:
1. AI calls `list_appointments` with a date range for this week
2. AI calls `search_conversations` with the resulting `contactIds`
3. Status shows "Ejecutando search_conversations…"
4. AI returns a summary of what was said in those conversations

- [ ] **Step 3: Test empty contactIds guard**

Ask the AI:

> "Usa search_conversations con una lista vacía"

Expected: AI receives `{ error: "contactIds is required and must be a non-empty array" }` and responds gracefully.

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(ai): address search_conversations edge cases found in browser testing"
```

Only commit if you made changes during testing. Skip if Task 3 was clean.
