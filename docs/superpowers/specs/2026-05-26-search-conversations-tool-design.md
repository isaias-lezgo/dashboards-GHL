# Design: search_conversations AI Tool

**Date:** 2026-05-26  
**Status:** Approved

## Problem

The AI chat panel has no way to fetch full conversation threads in bulk. `get_contact_messages` works for one contact at a time, so queries like "show me all recent conversations where advisor X had contact" or "show conversations for contacts with appointments this week" require the AI to make N sequential tool calls — slow, verbose, and often impractical.

## Solution

Add a `search_conversations` tool that accepts a `contactIds` array (derived by the AI from other tools) and returns full message threads for all of them in one call. The AI pipes contactIds from `list_appointments`, `search_contacts`, `search_pautas`, etc. into this tool — making it general-purpose for any filter combination.

## Tool Interface

**Name:** `search_conversations`

**Input schema:**
```json
{
  "contactIds": ["string"],        // required — derived from other tool calls
  "limit": 20,                     // optional, default 20, max 50
  "messageLimit": 100              // optional, default 100, no enforced cap
}
```

**Description sent to Claude:**
> Fetches full conversation message threads for a list of contacts from GoHighLevel. Always derive `contactIds` first using `list_appointments`, `search_contacts`, `search_opportunities`, or other tools — never ask the user for IDs. May take several seconds for large batches. Returns full message history per contact, newest first. For a single contact's conversation, use `get_contact_messages` instead.

## Architecture

Three files change. No new files created.

### 1. `lib/ai-tools.ts` — Tool schema only

Add `search_conversations` to `TOOL_DEFINITIONS`. No executor function needed — it is a server-side tool handled in the chat panel, the same as `get_contact_messages`. The `executeTool` switch statement is not touched.

### 2. `app/api/conversations/route.ts` — Parallelize + messageLimit param

Replace the serial `for` loop with `Promise.all` batched in groups of 10 contacts to avoid overwhelming GHL with simultaneous requests. Add a `messageLimit` query param (default 100) passed through to `getMessages`.

Batch logic:
```
for i = 0 to contactIds.length step 10:
  batch = contactIds[i..i+10]
  results = await Promise.all(batch.map(fetchThread))
  threads.push(...results)
```

All existing callers (single-contact `get_contact_messages`) continue to work unchanged — they just benefit from the same parallelized infrastructure.

### 3. `components/dashboard/ai-chat-panel.tsx` — New handler + routing

Add `fetchConversationThreads(input)` async function (mirrors `fetchContactMessages`):
- Reads `contactIds`, `limit`, `messageLimit` from input
- Clamps `limit` to max 50
- Calls `/api/conversations?contactIds=<csv>&messageLimit=<n>`
- Returns `{ returned, threads }` where each thread is `{ contactId, messageCount, messages[] }`

Add routing in the tool dispatch block:
```typescript
} else if (tu.name === "search_conversations") {
  result = await fetchConversationThreads(tu.input);
}
```

## Return Shape

```json
{
  "returned": 15,
  "threads": [
    {
      "contactId": "abc123",
      "messageCount": 45,
      "messages": [
        {
          "id": "...",
          "direction": "inbound",
          "source": "sms",
          "content": "Hola, me interesa...",
          "createdAt": "2026-05-25T14:32:00Z"
        }
      ]
    }
  ]
}
```

Messages are returned newest-first, content truncated to 500 chars per message (same as `get_contact_messages`).

## Error Handling

- Missing or empty `contactIds` → return `{ error: "contactIds is required and must be a non-empty array" }`
- Individual contact fetch failure → include `{ contactId, error: "..." }` in the thread, continue processing others
- HTTP error from `/api/conversations` → return `{ error: "GHL fetch failed (HTTP N)" }`

## Example Use Cases

- "Show me all recent conversations where advisor Karla had contact this week"
  → `list_appointments(startAfter: "2026-05-19", assignedTo: "Karla")` → contactIds → `search_conversations`

- "Show conversations for contacts that came from Meta ads"
  → `search_contacts(source: "meta")` → contactIds → `search_conversations`

- "What did we say to contacts currently in Primera Cita?"
  → `search_opportunities(stage: "Primera Cita")` → contactIds → `search_conversations`

## Files Changed

| File | Change |
|---|---|
| `lib/ai-tools.ts` | Add `search_conversations` to `TOOL_DEFINITIONS` |
| `app/api/conversations/route.ts` | Parallelize with batched `Promise.all`, add `messageLimit` param |
| `components/dashboard/ai-chat-panel.tsx` | Add `fetchConversationThreads`, add routing case |
