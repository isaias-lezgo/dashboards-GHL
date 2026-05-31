# Relate: Contact-Hub Cross-Entity Join — Design

**Date:** 2026-05-31
**Status:** Approved (design)

## Problem

The AI assistant is slow and token-heavy on cross-entity questions such as
"¿cuánto valen las citas de mayo?" or "¿qué ventas vinieron de la pauta X?".

Appointments, pautas, and messages have no direct link to opportunity *value* —
the **contact is the only join node**. The current system prompt
(`lib/ai-context.ts:157-169`) therefore mandates a manual, multi-step join that
the **model itself** orchestrates turn-by-turn:

1. `list_appointments` / `search_pautas` → returns rows
2. model extracts the unique `contactId`s
3. model calls `aggregate(opportunities, filters={contactIds:[...]})`

This is the root cause of the slowness:

- **Latency:** each step is a full round-trip (client → `/api/chat` → Anthropic →
  back, see `hooks/use-agent-loop.ts:142`). A single cross-entity question costs
  3–4 sequential model turns.
- **Tokens:** between steps the model emits and re-ingests a large array of raw
  `contactId`s as tool input/output. Those ID arrays bloat the transcript, and the
  whole growing conversation is re-sent on every turn.

## Goal

Make **any in-memory entity relatable to any other** through the contact hub
(appointments↔opportunities, pautas↔opportunities, appointments↔pautas,
opportunities↔anything, …) in a **single deterministic tool call**, attacking
both latency and token cost together.

The dataset is already fully loaded client-side (`ChatDataset` in `lib/ai-tools.ts`),
so the join is essentially free if precomputed — it requires **zero extra GHL calls**.

## Approach (chosen)

**Approach 1 + thin rollups:** a precomputed contact-hub join index, a single
general `relate` tool that traverses it in code, and small opportunity rollups
stamped onto compact appointment/pauta rows.

Rejected alternatives:
- **Row enrichment only** — can't express arbitrary cross-filters (e.g.
  "appointments whose contact has an open Meta opp") without combinatorial
  precomputation. Not truly any-to-any.
- **ID handles (keep model-driven join)** — cuts tokens but still 3+ turns, so
  latency barely improves. Half a fix.

## Components

### 1. Join index — `lib/ai-index.ts` (new file)

A single O(n) pass over each dataset array builds reverse lookups keyed on the
contact:

```ts
export interface ChatIndex {
  contactById:     Map<string, Contact>
  oppsByContact:   Map<string, Opportunity[]>
  pautasByContact: Map<string, Pauta[]>
  apptsByContact:  Map<string, Appointment[]>
  msgsByContact:   Map<string, Message[]>
}

export function buildChatIndex(data: ChatDataset): ChatIndex
export function getChatIndex(data: ChatDataset): ChatIndex
```

`getChatIndex` memoizes via a **module-level `WeakMap<Contact[], ChatIndex>`**
keyed on the `data.contacts` array reference (stable within a single agent run).
This means:

- The index is built once per dataset, not per tool call.
- **No prop-threading** through `app/page.tsx` or `hooks/use-agent-loop.ts` — the
  cache is internal to the tool layer. `executeTool` calls `getChatIndex(data)`.
- The cache is garbage-collected with the dataset (WeakMap).

Tradeoff noted: if `data.contacts` is recreated on every render, the index
rebuilds — but rebuilding is O(n) over already-in-memory arrays and only happens
when the array reference actually changes, which is stable during an agent run.

### 2. `relate` tool

Added to `TOOL_DEFINITIONS` and `executeTool` in `lib/ai-tools.ts`.

**Schema:**

```
relate(
  from: { entity: "contacts"|"opportunities"|"pautas"|"appointments", filters?: {...} },
  to:   { entity: "contacts"|"opportunities"|"pautas"|"appointments", filters?: {...} },
  metric?: "count" | "sum" | "avg",   // default "count"; sum/avg → opportunity.value only
  groupBy?: string,                    // field on the `to` entity; default "none"
  includeContactIds?: boolean,         // default false — keeps IDs out of the transcript
  limit?: number                       // max groups / max contactIds returned
)
```

**Mechanics (all in code, one turn):**

1. Apply the existing `applyContactFilters` / `applyOppFilters` /
   `applyPautaFilters` / `applyApptFilters` to `from.entity` rows → `fromRows`.
2. Collect the `contactId` set from `fromRows`. For `entity: "contacts"`, the
   contactId is the row's own `id`.
3. Gather `to.entity` rows whose `contactId` ∈ the set **via the index**
   (`getChatIndex(data).<to>ByContact`), not a full scan. For
   `to.entity: "contacts"`, resolve via `contactById`.
4. Apply `to.filters` to the gathered rows.
5. Aggregate using the **existing `aggregate` grouping/metric logic** (extract the
   bucket/metric code into a shared helper so `relate` and `aggregate` share it).

**Returns:**

```ts
{
  groups: Array<{ key: string; count: number; sum?: number; avg?: number }>,
  total: number,            // total `to` rows after filtering
  matchedContacts: number,  // distinct contacts in the join
  contactIds?: string[]     // only when includeContactIds:true, capped at `limit`
}
```

`includeContactIds` defaults to `false` so the common numeric path
("how much / how many") never puts IDs in the transcript. The model sets it
`true` only when the answer is a contact set it must then feed to `show_in_panel`
or a live per-contact fetch (tasks/notes). Returned `contactIds` are for tool
chaining only — the existing prompt rule forbids printing IDs in user-facing text.

### 3. Thin rollups on compact rows

`compactAppt` and `compactPauta` (in `lib/ai-tools.ts`) gain two derived fields
computed from the index:

- `oppCount` — number of opportunities for the row's contact
- `oppValueSum` — sum of those opportunities' `value`

So a plain `list_appointments` / `search_pautas` row carries opportunity context
without a second call. The compact mappers take the index (or the precomputed
rollup) as an argument; `executeTool` passes it through.

**Correctness rule (must be enforced in the prompt):** rollups are *display
context only*. A contact with two appointments would have its opportunity value
counted twice if summed across appointment rows. **All totals must go through
`relate`**, never by summing row-level `oppValueSum`.

### 4. System prompt rewrite — `lib/ai-context.ts`

Replace the manual 3-step join pattern (`ai-context.ts:157-169`, the
"Cross-entity joins — siempre van por el contacto" section) with guidance to use
`relate` in a single call:

- For ANY cross-entity question (citas↔oportunidades, pautas↔oportunidades,
  citas↔pautas, etc.), call `relate` **once**. Never hand-roll the join by
  extracting contactIds and re-filtering.
- Keep the contact-as-hub conceptual explanation.
- Provide the worked example "valor de citas de mayo" rewritten as a single
  `relate` call.
- State the rollup correctness rule: do not sum `oppValueSum` across rows; use
  `relate` for totals.
- Keep the live-fetch caveat: **tasks, notes, and full message history are not
  bulk-indexed** (GHL API limit). To answer "citas que también tienen tareas",
  first narrow the contact set with `relate(..., includeContactIds:true)`, then
  call the live per-contact tools (`get_contact_tasks` / `get_contact_notes` /
  `get_contact_messages`) only for that narrowed set.

This rewrite applies to both `CHAT_SYSTEM_PROMPT` and `CONVERSATIONS_SYSTEM_PROMPT`
where the join pattern is referenced.

### 5. Wiring

- `executeTool` (`lib/ai-tools.ts`) calls `getChatIndex(data)` and passes the
  index to `relate`, `listAppointments`, `searchPautas`, and `getContactRelated`.
- No changes to `hooks/use-agent-loop.ts`, `app/page.tsx`, or
  `components/dashboard/conversations-chat.tsx` — the index cache is internal.

## Out of scope

- Server-side agent loop or ID-handle store (Approach 3).
- Bulk indexing of tasks / notes / full message history — GHL does not expose
  these in bulk; they remain live per-contact fetches, narrowed by `relate`.
- Any change to the GHL fetch layer (`lib/ghl-client.ts`, `lib/ghl-fetchers.ts`).

## Verification

This project has no automated tests (`npm run build` ignores TS errors; see
`CLAUDE.md`). Verify manually:

1. `npm run dev`, open the AI chat.
2. Run representative prompts and confirm each resolves in **one** `relate` turn:
   - "¿cuánto valen las citas de mayo?" → `relate(from=appointments[May], to=opportunities, metric=sum)`
   - "¿qué ventas ganadas vinieron de la pauta X?" → `relate(from=pautas[X], to=opportunities[status=won], metric=sum)`
   - "citas que también tienen tareas" → `relate(..., includeContactIds:true)` then live task fetch on the narrowed set.
3. Spot-check the `relate` total against the old manual 3-step result for the same
   query (same number).
4. Confirm via the chat's turn/token counters that the cross-entity path now costs
   one turn and no contactId arrays appear in the transcript (unless
   `includeContactIds:true` was needed).
