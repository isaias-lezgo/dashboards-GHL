# AI CSV Export — Design Spec

**Date:** 2026-05-26  
**Status:** Approved

## Overview

Add a new `export_csv` tool to the AI chat panel so the AI can trigger browser CSV downloads as part of answering user questions. When a user asks to export, download, or save data, the AI calls `export_csv` with the same entity and filters it just used — no large row arrays flow through the model's context.

---

## Architecture

### Tool definition (`lib/ai-tools.ts`)

New entry in `TOOL_DEFINITIONS`:

```
name: "export_csv"
description: Call when the user asks to export, download, or save data.
             Use the same entity and filters from your most recent search_* call.
             Always confirm what exists with a search_* or aggregate call first,
             then call export_csv with the same entity + filters.
input_schema:
  entity:   required — "contacts" | "opportunities" | "appointments" | "pautas"
  filters:  optional object — same keys as the corresponding search_* tool
  columns:  optional string[] — subset of columns; defaults to entity preset
  filename: optional string — base name without extension (e.g. "contactos-meta-mayo")
            defaults to "{entity}-{YYYY-MM-DD}"
```

### Executor split

**`lib/ai-tools.ts` — `executeExportCsv(input, dataset)`**
- Runs the appropriate filter helper against the dataset
- Serializes to a CSV string (RFC 4180)
- Returns `{ csvContent: string, filename: string, rowCount: number }`
- No browser APIs — stays pure and testable

**`components/dashboard/ai-chat-panel.tsx`**
- Special-cases `"export_csv"` in the tool execution loop (same pattern as `get_contact_messages`)
- Receives the result from `executeExportCsv`
- Triggers download via `URL.createObjectURL(new Blob([csvContent], { type: "text/csv" }))` + a temporary `<a>` element
- Passes `{ success: true, filename, rowCount }` as the `tool_result` content back to the AI

---

## Column defaults per entity

| Entity | Columns |
|--------|---------|
| contacts | name, email, phone, companyName, city, state, country, source, campaign, adType, assignedTo, tags, dnd, createdAt |
| opportunities | name, contactId, pipeline, stage, status, value, currency, probability, priority, source, campaign, adType, assignedTo, closedAt, lostReason, createdAt |
| appointments | contactId, assignedTo, title, status, location, startTime |
| pautas | id, tipo, nombrePauta, contactId, createdAt + all `properties` keys flattened |

**Tags** on contacts are joined with `|` (pipe).  
**Pautas properties** keys are discovered dynamically from the loaded dataset.  
**Values** containing commas, double-quotes, or newlines are double-quote wrapped per RFC 4180.

---

## Appointment `location` field — new mapping required

The `location` field exists in GHL's raw calendar event payload but is not currently mapped. Three files need updating:

1. **`lib/ghl-client.ts`** — add `location?: string` to `GHLCalendarEvent`
2. **`lib/types.ts`** — add `location?: string` to `Appointment`
3. **`app/api/dashboard/route.ts`** — map `ev.location` when building `Appointment` objects

---

## System prompt addition (`lib/ai-context.ts`)

Append to `CHAT_SYSTEM_PROMPT`:

```
## Exportar a CSV

Cuando el usuario pida exportar, descargar o guardar datos:
1. Primero confirma qué datos existen con search_* o aggregate.
2. Llama export_csv con el mismo entity y filters que usaste en el paso anterior.
3. Nunca pases rows directamente — solo pasa entity + filters.
4. Informa al usuario el nombre del archivo y el número de filas exportadas.
   Ejemplo: "Listo — se descargó `contactos-meta.csv` con 142 contactos."
```

---

## CSV serialization rules

- First row: column header names (English field names, e.g. `name`, `email`, `assignedTo`)
- One row per record
- Empty/null values → empty cell
- Arrays (e.g. tags) → pipe-joined string: `tag1|tag2|tag3`
- Pautas `properties` object → each key becomes its own column
- Filename: user-provided base + `.csv`, or `{entity}-{YYYY-MM-DD}.csv` as default

---

## Files changed

| File | Change |
|------|--------|
| `lib/ghl-client.ts` | Add `location?: string` to `GHLCalendarEvent` |
| `lib/types.ts` | Add `location?: string` to `Appointment` |
| `app/api/dashboard/route.ts` | Map `ev.location` → `Appointment.location` |
| `lib/ai-tools.ts` | Add `export_csv` to `TOOL_DEFINITIONS`; add and export `executeExportCsv(input, dataset)` function; promote the private `applyContactFilters`, `applyOppFilters`, `applyPautaFilters`, `applyApptFilters` helpers to be usable by `executeExportCsv`. `executeTool`'s switch statement is NOT modified — `export_csv` is handled exclusively as a special case in the panel. |
| `lib/ai-context.ts` | Append CSV export instructions to `CHAT_SYSTEM_PROMPT` |
| `components/dashboard/ai-chat-panel.tsx` | Before calling `executeTool`, check if `tu.name === "export_csv"`. If so, call `executeExportCsv(tu.input, dataset)`, trigger the browser download, and return `{ success: true, filename, rowCount }` as the tool result. Never falls through to `executeTool` for this tool. |

---

## Out of scope

- No UI download button (browser download dialog is the UX)
- No server-side CSV generation
- No streaming or chunking (dataset is already in memory client-side)
- No i18n of column headers (English field names as-is)
