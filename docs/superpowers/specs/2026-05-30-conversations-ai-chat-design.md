# Conversaciones AI Chat — Design Spec

**Date:** 2026-05-30  
**Status:** Approved

---

## Overview

Replace the Conversations tab's filter wizard + two-panel message viewer with a full-page AI chat interface. The AI has live access to every piece of data GHL exposes for a contact: messages, opportunities, appointments, pautas, tasks, and notes.

---

## Layout

Two-column full-page layout inside the Conversations tab:

```
┌──────────────────────────────────────────────────────────┐
│  [Left panel: 300px]  │  [Chat: flex-1]                  │
│                       │                                   │
│  Adaptive context     │  Message history + input bar      │
│  (summary OR detail)  │                                   │
└──────────────────────────────────────────────────────────┘
```

### Left Panel — Two States

**State: `summary`** (triggered when AI returns multiple contacts)
- Header: "Resumen · N contactos" + query description
- Urgency card: count + breakdown by severity (🔴 +3d / 🟡 +24h / ⚪ recent)
- Value at risk: total opportunity value across the result set
- Channel breakdown: SMS / WhatsApp / Email / etc.
- "Most urgent" mini-list (top 3–4 contacts, clickable → switches to `contact` state)
- "Ver todos →" link

**State: `contact`** (triggered when AI focuses on one contact, or user clicks from list)
- Avatar + name + channel + time-since-last-reply badge
- Back arrow → returns to previous `summary` state
- Sections (in order):
  1. **Oportunidad** — pipeline name, value, stage, status badge
  2. **Citas** — next/recent appointment with status badge
  3. **Tareas** — live from GHL, overdue highlighted in red
  4. **Notas** — live from GHL, most recent note with author + date
  5. **Último mensaje** — content + direction + reply-status warning if unanswered
- Footer: "↗ Ver en Lezgo Suite" deep-link

**State: `idle`** (no AI response yet)
- Suggestion chips (same pattern as existing AIChatPanel EmptyState)

### Right Panel — Chat
- Standard message bubbles (user right, AI left) with markdown rendering
- Tool-use chips displayed between turns (same as existing AIChatPanel)
- Cost + tool count footer
- Stop / Reset / Send controls

---

## Component Architecture

### New files
- `components/dashboard/conversations-chat.tsx` — top-level full-page component (replaces `conversations-dashboard.tsx`)
- `components/dashboard/conversations-context-panel.tsx` — adaptive left panel
- `app/api/contact-tasks/route.ts` — GET `/api/contact-tasks?contactId=X` → fetches live tasks from GHL
- `app/api/contact-notes/route.ts` — GET `/api/contact-notes?contactId=X` → fetches live notes from GHL
- `hooks/use-agent-loop.ts` — shared agent loop hook (extracted from `ai-chat-panel.tsx`)
- `lib/ghl-fetchers.ts` — shared client-side GHL fetch helpers (fetchContactMessages, fetchConversationThreads, fetchContactTasks, fetchContactNotes)

### Modified files
- `app/page.tsx` — swap `<ConversationsDashboard>` for `<ConversationsChat>`; new props: `dataset: ChatDataset`, `locationId: string`, `members: string[]`, `pipelines: Pipeline[]`
- `lib/ai-tools.ts` — add two new tool definitions: `get_contact_tasks`, `get_contact_notes`
- `lib/ai-context.ts` — add conversations-focused system prompt `CONVERSATIONS_SYSTEM_PROMPT`
- `app/api/chat/route.ts` — no changes needed (backend is reused as-is)

### Deleted files
- `components/dashboard/conversations-dashboard.tsx` — replaced entirely

### Shared / reused (no changes)
- Agent loop logic: extracted from `ai-chat-panel.tsx` into `hooks/use-agent-loop.ts` (new shared hook) — both `AIChatPanel` and `ConversationsChat` consume it
- `fetchContactMessages` and `fetchConversationThreads` client-side fetchers: moved to `lib/ghl-fetchers.ts` (new shared module) — imported by both components
- Tool executor: `executeTool()` from `lib/ai-tools.ts` — unchanged
- `AIChatPanel` (Sheet sidebar for other tabs) — unchanged, updated to use the new hook

---

## New Tools

### `get_contact_tasks`
Fetches all tasks for a single contact live from GHL.

```json
{
  "name": "get_contact_tasks",
  "description": "Fetches all tasks for a contact directly from GoHighLevel. Returns task title, due date, status (completed/pending), and assigned user. Use when the user asks about pending work, follow-ups, or to-dos for a specific contact.",
  "input_schema": {
    "type": "object",
    "properties": {
      "contactId": { "type": "string", "description": "Contact ID to fetch tasks for." }
    },
    "required": ["contactId"]
  }
}
```

**API route:** `GET /api/contact-tasks?contactId={id}`  
Uses `lib/ghl-client.ts` → `GET /contacts/{id}/tasks` (Version: 2021-07-28)  
Returns: `{ tasks: [{ id, title, dueDate, status, assignedTo, completed }], count }`

### `get_contact_notes`
Fetches all notes for a single contact live from GHL.

```json
{
  "name": "get_contact_notes",
  "description": "Fetches all notes written on a contact in GoHighLevel. Notes are advisor-written observations (not chat messages). Use when the user asks what was noted, observed, or documented about a contact.",
  "input_schema": {
    "type": "object",
    "properties": {
      "contactId": { "type": "string", "description": "Contact ID to fetch notes for." }
    },
    "required": ["contactId"]
  }
}
```

**API route:** `GET /api/contact-notes?contactId={id}`  
Uses `lib/ghl-client.ts` → `GET /contacts/{id}/notes` (Version: 2021-07-28)  
Returns: `{ notes: [{ id, body, userId, dateAdded }], count }`

---

## Left Panel State Management

The context panel is driven by the AI's tool call results. After each agent turn the chat component inspects the tool results and updates panel state:

```ts
type PanelState =
  | { mode: "idle" }
  | { mode: "summary"; contacts: CompactContact[]; stats: SummaryStats }
  | { mode: "contact"; contact: Contact; related: ContactRelated }
```

**Transition rules:**
- Tool result from `search_contacts` with N > 1 contacts → compute urgency stats from contact data → `summary` (shows urgency breakdown, value at risk, channel counts, clickable mini-list)
- Tool result from `aggregate` → `summary` with a simplified stats panel (group counts/sums only; no urgency breakdown since aggregate doesn't return individual contacts)
- Tool result from `get_contact` / `get_contact_related` / `get_contact_messages` / `get_contact_tasks` / `get_contact_notes` → `contact` (panel populates progressively as each tool result arrives)
- Tool result from `search_conversations` with multiple threads → `summary` listing the contacts found
- User clicks a contact row in summary mini-list → `contact` (client-side, no AI call; contact data already in hand from previous `search_contacts` result)
- User clicks back arrow → returns to previous `summary` state (kept in memory, not re-queried)
- Contacts with no messages: urgency badge is omitted; "last message" section hidden in contact detail

---

## System Prompt

A new `CONVERSATIONS_SYSTEM_PROMPT` exported from `lib/ai-context.ts`, focused on:
- Conversation analysis (tone, urgency, response time)
- Identifying unanswered leads
- Drafting follow-up messages
- Cross-referencing conversations with tasks and notes ("what was noted vs. what was said")
- Suggesting next actions per contact

The existing `CHAT_SYSTEM_PROMPT` (used by the general AIChatPanel) is unchanged.

---

## Data Flow

```
app/page.tsx
  └─ passes ChatDataset (contacts, opps, pautas, appointments, messages, tasks, calls)
       └─ ConversationsChat
            ├─ ConversationsContextPanel  ← reads panelState
            └─ agent loop → /api/chat (unchanged)
                  ├─ executeTool() for in-memory tools (unchanged)
                  ├─ fetchContactMessages() → /api/conversations (unchanged)
                  ├─ fetchConversationThreads() → /api/conversations (unchanged)
                  ├─ fetchContactTasks() → /api/contact-tasks (NEW)
                  └─ fetchContactNotes() → /api/contact-notes (NEW)
```

---

## What Is NOT Changing

- `/api/chat` route — no changes
- `lib/ai-tools.ts` executor logic for existing tools — no changes
- `AIChatPanel` (Sheet sidebar accessible from header) — no changes
- All other tabs (Marketing, Sales) — no changes
- Mock data fallback — not needed for this feature (all new data is live GHL)

---

## Out of Scope

- Sending messages from the UI (read-only — the AI can draft but not send)
- Real-time push updates when new messages arrive
- Bulk actions on contacts from the panel
