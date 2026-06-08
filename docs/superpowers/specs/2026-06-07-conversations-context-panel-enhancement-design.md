# Conversations Context Panel Enhancement — Design Spec

**Date:** 2026-06-07
**Status:** Approved
**Builds on:** `2026-05-30-conversations-ai-chat-design.md`

---

## Overview

Enhance the left **context panel** of the Conversations "Asistente IA" tab
(`ConversationsContextPanel`). Two goals:

1. **Summary state** → turn the flat contact list into a scannable triage view
   (urgency breakdown, channel mix, per-row urgency signal).
2. **Contact state** → stop showing only the last message. Rebuild it to mirror
   the dashboard's `DetailDrawer`: contact info, opportunity, appointments,
   pautas, and a small last-in/last-out conversation snippet.

**Hard constraint:** the panel must populate **entirely from the in-memory
`ChatDataset`** (already passed to `ConversationsChat`), filtered by `contactId`.
No live GHL fetches (`fetchContactMessages/Tasks/Notes`) and no AI tool calls to
hydrate the panel — those waste tokens/round-trips. Use the data already in hand,
exactly like `DetailDrawer` does.

---

## Summary State — Triage View

When the AI returns multiple contacts (`search_contacts`, `search_conversations`,
`show_in_panel`, `aggregate`), the panel shows:

- **Header** — `{title} · N contactos` + optional query description (unchanged).
- **Urgencia card** (NEW) — a 3-segment bar + counts:
  - 🔴 `+3d` — last message is inbound and older than 72h (no advisor reply)
  - 🟡 `+24h` — last message is inbound, 24–72h old
  - ⚪ `recientes` — last message inbound < 24h, or last message is outbound
  - Omitted entirely if no contact in the set has any in-memory messages.
- **En riesgo** — total value of open opportunities across the set (existing
  `valueAtRisk`, kept; rendered compact, e.g. `$48.5k`).
- **Canales card** (NEW) — horizontal stacked bar of contacts by their latest
  message channel (WhatsApp / SMS / Email / Instagram / Facebook / TikTok /
  other), with a small legend of the top channels.
- **Distribución** — aggregate group counts/sums (existing `groups`, kept; only
  for the `aggregate` path).
- **Contact list** — each row enriched:
  - urgency dot (red/yellow/grey) next to the name
  - subtitle = channel label + "sin respuesta" when the last message is inbound
    (falls back to `source`/`assignedTo` when no messages in memory)
  - trailing badge = time since last activity (e.g. `5d`, `28h`, `10h`),
    colored to match the urgency bucket
  - rows **sorted most-urgent first** (red → yellow → grey → unknown)
  - "Ver los N →" footer when truncated

Contacts not present in the in-memory dataset (e.g. a live conversation-search
result not loaded) keep their current minimal rendering — no dot, no badge.

## Contact State — Drawer-style, from memory

Replace the current `Oportunidad / Citas / Tareas / Notas / Último mensaje`
layout with sections sourced from the in-memory dataset by `contactId`:

1. **Header** — avatar, name, channel + assigned advisor subtitle, opportunity
   **status badge** (open/won/lost/abandoned, drawer color logic), and **tags**
   (drawer's `getTagStyle` semantic colors). Back arrow when arriving from a
   summary.
2. **Oportunidad** — primary opportunity: value, name, stage, pipeline. (Omitted
   if the contact has no opportunity.)
3. **Contacto** — 2-col grid: email, phone, registro (`createdAt`), medio
   (`adType`). Assigned advisor if present.
4. **Citas** — appointments for the contact (from `dataset.appointments`),
   sorted newest first, each with a status badge.
5. **Pautas** — pautas for the contact (from `dataset.pautas`), newest first,
   with tipo chip + date. **Replaces** the old Tareas/Notas sections (those
   required live GHL calls and are not in memory).
6. **Conversación** — small section at the bottom: last inbound + last outbound
   message (from `dataset.messages`, `kind !== "activity"`), with a
   `N mensajes en total` count. "Sin respuesta del asesor" hint when the most
   recent message is inbound. Omitted if the contact has no messages in memory.
7. **Footer** — `↗ Ver contacto` and `↗ Ver oportunidad` deep links to Lezgo
   Suite (opportunity link only when an opportunity exists).

Empty sections (no opportunity / no citas / no pautas / no messages) are simply
omitted, matching the drawer.

---

## Data & Computation

All computation is pure and client-side. Extract into a new module
`lib/conversations-panel.ts` to keep `conversations-chat.tsx` lean:

```ts
type UrgencyBucket = "red" | "yellow" | "grey" | "none";

interface ContactUrgency {
  channel?: MessageChannel | "system";
  lastActivityAt?: string;   // ISO of most recent message
  unanswered: boolean;       // most recent message is inbound
  bucket: UrgencyBucket;     // from age of last inbound; "none" when no messages
}

// Most-recent message for a contact drives channel + bucket.
function computeContactUrgency(contactId: string, messages: Message[]): ContactUrgency;

// Builds the enriched summary panel state (urgency counts, channel counts,
// value at risk, sorted enriched rows) from a set of contacts + the dataset.
function buildSummaryState(contacts, dataset, opts): Extract<PanelState, {mode:"summary"}>;

// Hydrates the full contact-mode state from the in-memory dataset by id.
function buildContactState(contactId, dataset, prevSummary?): Extract<PanelState, {mode:"contact"}>;
```

**Urgency bucket** from the most-recent message:
- last message inbound, age > 72h → `red`
- last message inbound, 24h ≤ age ≤ 72h → `yellow`
- last message inbound, age < 24h → `grey`
- last message outbound → `grey` (answered)
- no messages in memory → `none`

**Channel** = `source` of the most-recent non-activity message.

---

## PanelState Type Changes

`conversations-context-panel.tsx`:

- `PanelContact` gains optional enriched fields: `channel?`, `lastActivityAt?`,
  `unanswered?`, `urgency?: UrgencyBucket`.
- Summary variant gains: `urgency?: { red: number; yellow: number; grey: number }`,
  `channels?: { key: string; count: number }[]`.
- Contact variant is reshaped:
  - **remove** `tasks`, `notes`, `lastMessage`
  - **add** `pautas: PanelPauta[]`, `lastInbound: PanelMessage | null`,
    `lastOutbound: PanelMessage | null`, `messageCount: number`,
    `status?: string` (from primary opportunity), and contact fields
    `createdAt?`, `adType?`.
- New small interfaces: `PanelPauta { id; nombrePauta; tipo?; createdAt }`,
  `PanelMessage { direction; source; content?; createdAt }`.

---

## `conversations-chat.tsx` Changes

- `handleContactClick` — replace the async live-fetch block with a synchronous
  `setPanelState(buildContactState(contact.id, dataset, prevSummaryRef.current))`.
- `onToolExecuted` — when a tool focuses a single contact (`get_contact`,
  single-row `search_contacts`), call `buildContactState` to hydrate from memory
  instead of the progressive empty-then-fill pattern. For multi-contact results,
  call `buildSummaryState`. **Remove** the panel-hydration branches for
  `get_contact_related`, `get_contact_tasks`, `get_contact_notes` (those tools
  remain available to the AI for answering questions — they just no longer drive
  the panel).
- Drop now-unused imports (`fetchContactMessages`, `fetchContactTasks`,
  `fetchContactNotes`) if no longer referenced.

---

## What Is NOT Changing

- `/api/chat`, the agent loop, and the AI tool executor — unchanged.
- The AI tools `get_contact_tasks` / `get_contact_notes` still exist for the
  model to answer questions; they just no longer populate the panel.
- The chat (right) column — unchanged.
- `AIChatPanel`, Marketing, Sales tabs — unchanged.
- The summary state's existing `aggregate` distribution rendering — kept.

## Out of Scope

- Fetching tasks/notes for the panel (removed — not in memory).
- Live message threads in the panel (only last in/out from memory).
- Pagination / "ver todos" navigation beyond the existing truncation.
- Sending messages from the panel.
