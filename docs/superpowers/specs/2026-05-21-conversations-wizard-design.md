# Conversations Tab — Wizard Design

**Date:** 2026-05-21  
**Status:** Approved

## Overview

Replace the auto-loading Conversations tab with a wizard-style experience. The tab opens instantly with a filter form. Conversations only load when the user explicitly clicks "Cargar conversaciones." Pagination loads 50 more at a time. A CSV export covers all currently-loaded threads.

---

## State Machine

| State | What's visible |
|-------|---------------|
| `idle` | Filter form card only |
| `loading` | Filter form + spinner, Load button disabled |
| `loaded` | Collapsed filter summary bar + two-panel view + action buttons |
| `exporting` | Same as `loaded`, Export button shows spinner |

---

## Filter Form (idle / loading states)

Centered card with four optional fields:

1. **Assigned user** — single-select from `members` (passed as prop)
2. **Tag** — single-select from `availableTags` (passed as prop)
3. **Pipeline** — single-select from `pipelines[].name`; selecting one enables the Stage dropdown
4. **Stage** — single-select from `pipelines[i].stages`; disabled until a pipeline is selected
5. **How many** — dropdown: `5`, `10`, `15`, `50`

**"Cargar conversaciones"** button triggers the load.

All filters are optional. Submitting with no filters loads the most recent N conversations across all contacts.

### Client-side filtering logic (ANDed)

```
tag filter     → contacts where c.tags.includes(selectedTag)
user filter    → contacts where c.assignedTo === selectedUser
pipeline/stage → opportunities where pipelineName === p && stage === s
                 → unique contactIds from those opps
                 → contacts filtered to that contactId set
```

Result is a `filteredContactIds: string[]` array. The first N (per "how many" dropdown) are fetched on initial load.

---

## Loaded State

### Action bar (above the two panels)

```
[Cambiar filtros]  ·  <filter summary>     [Cargar 50 más]  [Exportar CSV]
```

- **Cambiar filtros** — resets to `idle`, clears loaded data
- **Filter summary** — e.g. "Tag: Hot Lead · Etapa: Calificado · 10 contactos"
- **Cargar 50 más** — fetches the next 50 contactIds from `filteredContactIds`; hidden when all are loaded
- **Exportar CSV** — generates CSV from all currently-loaded threads; triggers browser download

### Two-panel layout (unchanged)

Left panel: contact list with last-message preview, tags, timestamp.  
Right panel: full message thread for selected contact.  
Appending more contacts adds them at the bottom of the left list without changing the selected contact.

---

## New API Route: `GET /api/conversations`

**Query params:** `contactIds` (comma-separated string)

**Per contactId:**
1. `getConversations({ contactId, limit: 20 })` — fetch conversation list
2. Take the first (most recent) conversation
3. `getMessages(conv.id, { limit: 100 })` — fetch full thread

**Response:**
```json
{
  "threads": [
    {
      "contactId": "string",
      "messages": [
        { "id": "string", "direction": "inbound|outbound", "source": "sms|email|...", "content": "string", "createdAt": "string" }
      ]
    }
  ]
}
```

Contact metadata (name, email, phone, tags) is NOT returned — the client already has it from the main dashboard data.

---

## CSV Export

Generated client-side from loaded threads. No extra API call.

**Filename:** `conversaciones-YYYY-MM-DD.csv`

**Columns:** `Nombre`, `Email`, `Teléfono`, `Tags`, `Fecha`, `Dirección`, `Canal`, `Mensaje`

One row per message. If the user wants more data in the export, they load more contacts first via "Cargar 50 más."

---

## Props Changes

`ConversationsDashboard` receives:

| Prop | Type | Source |
|------|------|--------|
| `contacts` | `Contact[]` | existing |
| `opportunities` | `Opportunity[]` | new |
| `pipelines` | `Pipeline[]` | new |
| `members` | `string[]` | new |
| `availableTags` | `string[]` | new |

`messages` prop is **removed** — the component fetches its own message data on demand.

`page.tsx` passes `data?.pipelines ?? []`, `stableMembers`, and `stableTags` to `ConversationsDashboard`.

---

## Files Changed

| File | Change |
|------|--------|
| `components/dashboard/conversations-dashboard.tsx` | Full rewrite — wizard state machine, filter form, action bar |
| `app/api/conversations/route.ts` | New file — per-contact thread fetcher |
| `app/page.tsx` | Pass new props to `ConversationsDashboard`, remove `messages` prop |
