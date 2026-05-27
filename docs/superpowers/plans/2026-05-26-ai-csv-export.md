# AI CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `export_csv` AI tool that lets the chat agent trigger browser CSV downloads against the already-loaded dashboard dataset.

**Architecture:** A new `export_csv` entry in `TOOL_DEFINITIONS` (sent to Claude as a usable tool). The panel special-cases its execution: calls the pure `executeExportCsv` function in `lib/ai-tools.ts`, triggers a browser download via a Blob URL, and returns `{ success, filename, rowCount }` to the model. No row data flows through the model — only entity + filters.

**Tech Stack:** TypeScript, Next.js 15 App Router, Anthropic SDK (already wired), browser Blob/URL APIs.

---

## File Map

| File | Change |
|------|--------|
| `lib/ghl-client.ts` | Add `location?: string` to `GHLCalendarEvent` |
| `lib/types.ts` | Add `location?: string` to `Appointment` |
| `app/api/dashboard/route.ts` | Map `ev.location` when building `Appointment` |
| `lib/ai-tools.ts` | Add `export_csv` to `TOOL_DEFINITIONS`; add `ExportCsvResult`, `executeExportCsv`; update `compactAppt` to expose `location` |
| `lib/ai-context.ts` | Append CSV export instructions to `CHAT_SYSTEM_PROMPT` |
| `components/dashboard/ai-chat-panel.tsx` | Import `executeExportCsv`; add `triggerCsvDownload`; special-case `export_csv` in tool loop; update `previewResult` |

---

## Task 1: Add `location` to the Appointment type chain

**Files:**
- Modify: `lib/ghl-client.ts:440-452`
- Modify: `lib/types.ts:129-138`

- [ ] **Step 1.1 — Add `location` to `GHLCalendarEvent`**

In `lib/ghl-client.ts`, find the `GHLCalendarEvent` interface (line 440) and add the field after `notes?`:

```typescript
export interface GHLCalendarEvent {
  id: string;
  title?: string;
  calendarId: string;
  contactId: string;
  status: string;
  startTime: string;
  endTime: string;
  appointmentStatus?: string;
  assignedUserId?: string;
  notes?: string;
  location?: string;
  dateAdded: string;
}
```

- [ ] **Step 1.2 — Add `location` to `Appointment`**

In `lib/types.ts`, find the `Appointment` interface (line 129) and add the field after `notes?`:

```typescript
export interface Appointment {
  id: string
  contactId: string
  assignedTo?: string
  title?: string
  startTime: string
  endTime: string
  status: string
  notes?: string
  location?: string
}
```

- [ ] **Step 1.3 — Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors (or the same pre-existing errors as before this change — do not introduce new ones).

- [ ] **Step 1.4 — Commit**

```bash
git add lib/ghl-client.ts lib/types.ts
git commit -m "feat(types): add location field to GHLCalendarEvent and Appointment"
```

---

## Task 2: Map `location` in the API route

**Files:**
- Modify: `app/api/dashboard/route.ts:486-495`

- [ ] **Step 2.1 — Pass `ev.location` when building each Appointment**

Find the `appointments.push({...})` block (around line 486) and add `location`:

```typescript
appointments.push({
  id: ev.id,
  contactId: ev.contactId,
  assignedTo: advisorName,
  title: ev.title,
  startTime: ev.startTime,
  endTime: ev.endTime,
  status: (ev.appointmentStatus ?? "").toLowerCase() || "sin estado",
  notes: ev.notes,
  location: ev.location,
});
```

- [ ] **Step 2.2 — Type-check**

```bash
npx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 2.3 — Commit**

```bash
git add app/api/dashboard/route.ts
git commit -m "feat(api): map appointment location from GHL calendar event"
```

---

## Task 3: Add `export_csv` to TOOL_DEFINITIONS

**Files:**
- Modify: `lib/ai-tools.ts:234-236`

- [ ] **Step 3.1 — Insert the tool definition before `] as const`**

Find the closing `] as const;` at line 236 and insert the new entry before it:

```typescript
  {
    name: "export_csv",
    description:
      "Exports a filtered dataset to a CSV file that the user can download. Call this when the user asks to export, download, or save data to a file. Always run a search_* or aggregate call first to confirm what data exists, then call export_csv with the same entity and filters. NEVER pass rows directly — only pass entity + filters.",
    input_schema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          enum: ["contacts", "opportunities", "appointments", "pautas"],
          description: "The entity to export.",
        },
        filters: {
          type: "object",
          description:
            "Optional filters — same keys as the corresponding search_* tool. Contacts: source, campaign, adType, assignedTo, tags, companyName, city, state, country, dnd, createdAfter, createdBefore, contactIds. Opportunities: status, source, assignedTo, stage, pipeline, priority, archived, minValue, maxValue, minProbability, maxProbability, createdAfter, createdBefore, closedAfter, closedBefore, contactIds. Pautas: tipo, contactId. Appointments: status, assignedTo, startAfter, startBefore.",
          additionalProperties: true,
        },
        columns: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional subset of column names to include. Defaults to all standard columns for the entity.",
        },
        filename: {
          type: "string",
          description:
            "Suggested base filename without extension (e.g. 'contactos-meta-mayo'). Defaults to '{entity}-{YYYY-MM-DD}'.",
        },
      },
      required: ["entity"],
    },
  },
] as const;
```

- [ ] **Step 3.2 — Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3.3 — Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat(ai): add export_csv tool definition"
```

---

## Task 4: Implement `executeExportCsv` and update `compactAppt`

**Files:**
- Modify: `lib/ai-tools.ts` (after the `executeTool` function, before the private filter helpers)

- [ ] **Step 4.1 — Update `compactAppt` to include `location`**

Find the `compactAppt` function in `lib/ai-tools.ts` and add `location`:

```typescript
function compactAppt(a: Appointment) {
  return {
    id: a.id,
    contactId: a.contactId,
    assignedTo: a.assignedTo,
    title: a.title,
    startTime: a.startTime,
    status: a.status,
    location: a.location,
  };
}
```

- [ ] **Step 4.2 — Add `ExportCsvResult` interface and `executeExportCsv` function**

Add this block immediately after the closing `}` of `executeTool` (before `// ─── list_fields ───`):

```typescript
// ─── CSV export ───────────────────────────────────────────────────────────────

export interface ExportCsvResult {
  csvContent: string;
  filename: string;
  rowCount: number;
}

const CSV_COLUMNS: Record<string, string[]> = {
  contacts: [
    "name", "email", "phone", "companyName", "city", "state", "country",
    "source", "campaign", "adType", "assignedTo", "tags", "dnd", "createdAt",
  ],
  opportunities: [
    "name", "contactId", "pipeline", "stage", "status", "value", "currency",
    "probability", "priority", "source", "campaign", "adType", "assignedTo",
    "closedAt", "lostReason", "createdAt",
  ],
  appointments: ["contactId", "assignedTo", "title", "status", "location", "startTime"],
  pautas: ["id", "tipo", "nombrePauta", "contactId", "createdAt"],
};

function csvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = Array.isArray(val) ? (val as unknown[]).join("|") : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines: string[] = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(","));
  }
  return lines.join("\r\n");
}

export function executeExportCsv(input: ToolInput, data: ChatDataset): ExportCsvResult {
  const entity = String(input.entity ?? "");
  const filters = (
    input.filters && typeof input.filters === "object" ? input.filters : {}
  ) as ToolInput;
  const userColumns = Array.isArray(input.columns) ? (input.columns as string[]) : null;
  const today = new Date().toISOString().slice(0, 10);
  const baseFilename =
    typeof input.filename === "string" && input.filename.trim()
      ? input.filename.trim().replace(/\.csv$/i, "")
      : `${entity}-${today}`;
  const filename = `${baseFilename}.csv`;

  let headers: string[];
  let rows: Array<Record<string, unknown>>;

  switch (entity) {
    case "contacts": {
      const filtered = applyContactFilters(data.contacts, filters);
      headers = userColumns ?? CSV_COLUMNS.contacts;
      rows = filtered.map((c) => ({
        name: c.name,
        email: c.email ?? "",
        phone: c.phone ?? "",
        companyName: c.companyName ?? "",
        city: c.city ?? "",
        state: c.state ?? "",
        country: c.country ?? "",
        source: c.source ?? "",
        campaign: c.campaign ?? "",
        adType: c.adType ?? "",
        assignedTo: c.assignedTo ?? "",
        tags: (c.tags ?? []).join("|"),
        dnd: c.dnd ? "true" : "false",
        createdAt: c.createdAt,
      }));
      break;
    }
    case "opportunities": {
      const filtered = applyOppFilters(data.opportunities, filters);
      headers = userColumns ?? CSV_COLUMNS.opportunities;
      rows = filtered.map((o) => ({
        name: o.name,
        contactId: o.contactId,
        pipeline: o.pipelineName ?? "",
        stage: o.stage ?? "",
        status: o.status,
        value: o.value,
        currency: o.currency ?? "",
        probability: o.probability ?? "",
        priority: o.priority ?? "",
        source: o.source ?? "",
        campaign: o.campaign ?? "",
        adType: o.adType ?? "",
        assignedTo: o.assignedTo ?? "",
        closedAt: o.closedAt ?? "",
        lostReason: o.lostReason ?? "",
        createdAt: o.createdAt,
      }));
      break;
    }
    case "appointments": {
      const filtered = applyApptFilters(data.appointments, filters);
      headers = userColumns ?? CSV_COLUMNS.appointments;
      rows = filtered.map((a) => ({
        contactId: a.contactId,
        assignedTo: a.assignedTo ?? "",
        title: a.title ?? "",
        status: a.status,
        location: a.location ?? "",
        startTime: a.startTime,
      }));
      break;
    }
    case "pautas": {
      const filtered = applyPautaFilters(data.pautas, filters);
      const propKeys = new Set<string>();
      for (const p of filtered) {
        if (p.properties) for (const k of Object.keys(p.properties)) propKeys.add(k);
      }
      const propCols = Array.from(propKeys).sort();
      headers = userColumns ?? [...CSV_COLUMNS.pautas, ...propCols];
      rows = filtered.map((p) => {
        const base: Record<string, unknown> = {
          id: p.id,
          tipo: p.tipo ?? "",
          nombrePauta: p.nombrePauta ?? "",
          contactId: p.contactId ?? "",
          createdAt: p.createdAt,
        };
        for (const k of propCols) {
          base[k] = p.properties?.[k] ?? "";
        }
        return base;
      });
      break;
    }
    default:
      return { csvContent: "", filename, rowCount: 0 };
  }

  return { csvContent: buildCsv(headers, rows), filename, rowCount: rows.length };
}
```

- [ ] **Step 4.3 — Type-check**

```bash
npx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 4.4 — Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat(ai): implement executeExportCsv with RFC 4180 CSV serialization"
```

---

## Task 5: Update the system prompt

**Files:**
- Modify: `lib/ai-context.ts:182` (end of `CHAT_SYSTEM_PROMPT` string)

- [ ] **Step 5.1 — Append CSV export instructions**

Find the closing backtick of `CHAT_SYSTEM_PROMPT` (the last line of the template literal, currently ending with `...sin ningún otro identificador técnico interno en tus respuestas...`). Add the new section before the closing backtick:

```typescript
export const CHAT_SYSTEM_PROMPT = `...existing content...

# Exportar a CSV

Cuando el usuario pida exportar, descargar o guardar datos en un archivo:
1. Primero confirma qué datos existen con \`search_*\` o \`aggregate\`.
2. Llama \`export_csv\` con el mismo \`entity\` y \`filters\` que usaste en el paso anterior. NUNCA pases \`rows\` directamente.
3. Informa al usuario el nombre del archivo y el número de filas exportadas.
   Ejemplo: "Listo — se descargó \`contactos-meta.csv\` con 142 contactos."`;
```

Specifically, inside the template literal at the very end (before the closing backtick), add:

```
\n\n# Exportar a CSV\n\nCuando el usuario pida exportar, descargar o guardar datos en un archivo:\n1. Primero confirma qué datos existen con \`search_*\` o \`aggregate\`.\n2. Llama \`export_csv\` con el mismo \`entity\` y \`filters\` que usaste en el paso anterior. NUNCA pases \`rows\` directamente.\n3. Informa al usuario el nombre del archivo y el número de filas exportadas.\n   Ejemplo: "Listo — se descargó \`contactos-meta.csv\` con 142 contactos."
```

- [ ] **Step 5.2 — Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5.3 — Commit**

```bash
git add lib/ai-context.ts
git commit -m "feat(ai): add CSV export instructions to system prompt"
```

---

## Task 6: Wire `export_csv` in the chat panel

**Files:**
- Modify: `components/dashboard/ai-chat-panel.tsx`

- [ ] **Step 6.1 — Update the import from `@/lib/ai-tools`**

Find line 17:
```typescript
import { executeTool, type ChatDataset } from "@/lib/ai-tools";
```

Replace with:
```typescript
import { executeTool, executeExportCsv, type ChatDataset, type ExportCsvResult } from "@/lib/ai-tools";
```

- [ ] **Step 6.2 — Add `triggerCsvDownload` helper after the imports block**

Add this function after all imports and before the interface declarations (around line 20):

```typescript
function triggerCsvDownload({ csvContent, filename }: ExportCsvResult): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 6.3 — Special-case `export_csv` in the tool execution loop**

Find the tool execution block inside `runAgentLoop` (around line 229-250). The current code is:

```typescript
const result =
  tu.name === "get_contact_messages"
    ? await fetchContactMessages(tu.input)
    : executeTool(tu.name, tu.input, dataset);
```

Replace with:

```typescript
let result: unknown;
if (tu.name === "get_contact_messages") {
  result = await fetchContactMessages(tu.input);
} else if (tu.name === "export_csv") {
  const exportResult = executeExportCsv(tu.input, dataset);
  if (exportResult.rowCount > 0) triggerCsvDownload(exportResult);
  result = {
    success: exportResult.rowCount > 0,
    filename: exportResult.filename,
    rowCount: exportResult.rowCount,
  };
} else {
  result = executeTool(tu.name, tu.input, dataset);
}
```

- [ ] **Step 6.4 — Update `previewResult` to show a friendly export chip**

Find the `previewResult` function (around line 551) and add a case before the `Array.isArray(parsed?.rows)` check:

```typescript
function previewResult(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed?.error) return `error: ${String(parsed.error).slice(0, 80)}`;
    if (typeof parsed?.filename === "string" && typeof parsed?.rowCount === "number") {
      return parsed.success
        ? `${parsed.rowCount} filas → ${parsed.filename}`
        : `sin filas — nada exportado`;
    }
    if (Array.isArray(parsed?.rows)) {
      return `${parsed.returned ?? parsed.rows.length} fila${(parsed.returned ?? parsed.rows.length) === 1 ? "" : "s"}${parsed.truncated ? " (truncado)" : ""}`;
    }
    if (Array.isArray(parsed?.groups)) {
      return `${parsed.groups.length} grupo${parsed.groups.length === 1 ? "" : "s"} · total ${parsed.total ?? "?"}`;
    }
    if (parsed?.id) return `id ${String(parsed.id).slice(0, 20)}`;
    return `${Object.keys(parsed ?? {}).length} campos`;
  } catch {
    return content.slice(0, 60);
  }
}
```

- [ ] **Step 6.5 — Type-check**

```bash
npx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 6.6 — Commit**

```bash
git add components/dashboard/ai-chat-panel.tsx
git commit -m "feat(ui): wire export_csv tool — triggers browser CSV download from AI chat"
```

---

## Task 7: Manual smoke test

- [ ] **Step 7.1 — Start dev server**

```bash
npm run dev
```

Open `http://localhost:3000`.

- [ ] **Step 7.2 — Open AI chat and run an export**

Click the Sparkles button to open the AI chat panel. Send:

> "Exporta todos los contactos de Meta a CSV"

Expected sequence in the chat:
1. AI calls `list_values` or `search_contacts` to confirm source values
2. AI calls `export_csv` with `entity: "contacts"` and appropriate filters
3. Browser download dialog appears for a `.csv` file
4. AI replies confirming the filename and row count
5. Tool result chip shows e.g. `142 filas → contactos-2026-05-26.csv`

- [ ] **Step 7.3 — Verify CSV contents**

Open the downloaded file in a spreadsheet or text editor. Confirm:
- First row is the header: `name,email,phone,companyName,...`
- Data rows match the contacts visible in the dashboard
- Commas inside values are properly quoted
- Tags column uses `|` as separator

- [ ] **Step 7.4 — Test opportunities export**

Send: `"Dame un CSV de todas las oportunidades perdidas"`

Expected: file downloads with `status` column = `lost` for all rows.

- [ ] **Step 7.5 — Test appointments export**

Send: `"Exporta las citas de esta semana"`

Expected: file downloads with `location` column present (may be empty if GHL doesn't return it for this account).

- [ ] **Step 7.6 — Final commit if any adjustments were made**

```bash
git add -p
git commit -m "fix: csv export smoke test adjustments"
```
