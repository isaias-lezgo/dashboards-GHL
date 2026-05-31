# Relate Cross-Entity Join — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow, token-heavy model-orchestrated 3-step contact join with a precomputed contact-hub index + a single deterministic `relate` tool, plus thin opportunity rollups on appointment/pauta rows.

**Architecture:** Build a `ChatIndex` (reverse lookups keyed on contactId) once per dataset, cached in a module-level `WeakMap`. A new `relate` tool filters a `from` set, hops to the same contacts' `to` records via the index, applies `to` filters, and aggregates — all in code, one turn. The existing `aggregate` grouping/metric logic is extracted into a shared helper that `relate` reuses. The system prompt is rewritten to mandate `relate` for cross-entity questions.

**Tech Stack:** TypeScript, Next.js 15 (App Router), client-side tool executor (`lib/ai-tools.ts`), Anthropic SDK.

---

## Reference: spec

Design spec: `docs/superpowers/specs/2026-05-31-relate-cross-entity-join-design.md`

## File Structure

- **Create** `lib/ai-index.ts` — `ChatIndex` type, `buildChatIndex`, `getChatIndex` (WeakMap-cached). One responsibility: precompute contact-hub reverse lookups.
- **Modify** `lib/ai-tools.ts` — extract `filteredRows` + `aggregateRows` shared helpers; add `relate` executor + its helpers; add `relate` to `TOOL_DEFINITIONS`; add `oppCount`/`oppValueSum` rollups to `compactAppt`/`compactPauta`; thread the index through `listAppointments`/`searchPautas`/`getContactRelated`/`executeTool`.
- **Modify** `lib/ai-context.ts` — rewrite the cross-entity join section in `CHAT_SYSTEM_PROMPT`; add a `relate` pointer to `CONVERSATIONS_SYSTEM_PROMPT`.

No changes to `hooks/use-agent-loop.ts`, `app/page.tsx`, or `components/dashboard/conversations-chat.tsx` — the index cache is internal to the tool layer.

**Import-cycle note:** `lib/ai-index.ts` imports `ChatDataset` from `lib/ai-tools.ts` as a **type-only** import (erased at compile, no runtime cycle), while `lib/ai-tools.ts` imports the runtime `getChatIndex` from `lib/ai-index.ts`. `lib/ai-index.ts` has no runtime dependency back on `lib/ai-tools.ts`, so there is no runtime cycle.

---

## Task 1: Create the contact-hub join index

**Files:**
- Create: `lib/ai-index.ts`

- [ ] **Step 1: Write `lib/ai-index.ts`**

```ts
// Contact-hub join index. Appointments, pautas, and messages only relate to
// opportunity value through their shared contact. Precomputing reverse lookups
// once lets the `relate` tool traverse those links in code (one turn) instead of
// the model orchestrating a multi-turn contactId join.

import type {
  Contact,
  Opportunity,
  Pauta,
  Appointment,
  Message,
} from "@/lib/types";
import type { ChatDataset } from "@/lib/ai-tools";

export interface ChatIndex {
  contactById: Map<string, Contact>;
  oppsByContact: Map<string, Opportunity[]>;
  pautasByContact: Map<string, Pauta[]>;
  apptsByContact: Map<string, Appointment[]>;
  msgsByContact: Map<string, Message[]>;
}

function pushTo<T>(map: Map<string, T[]>, key: string | undefined, val: T): void {
  if (!key) return;
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

export function buildChatIndex(data: ChatDataset): ChatIndex {
  const contactById = new Map<string, Contact>();
  for (const c of data.contacts) contactById.set(c.id, c);

  const oppsByContact = new Map<string, Opportunity[]>();
  for (const o of data.opportunities) pushTo(oppsByContact, o.contactId, o);

  const pautasByContact = new Map<string, Pauta[]>();
  for (const p of data.pautas) pushTo(pautasByContact, p.contactId, p);

  const apptsByContact = new Map<string, Appointment[]>();
  for (const a of data.appointments) pushTo(apptsByContact, a.contactId, a);

  const msgsByContact = new Map<string, Message[]>();
  for (const m of data.messages) pushTo(msgsByContact, m.contactId, m);

  return { contactById, oppsByContact, pautasByContact, apptsByContact, msgsByContact };
}

// Cache keyed on the contacts array reference (stable within a single agent run),
// so the index is built once per dataset rather than on every tool call. The
// WeakMap entry is garbage-collected with the dataset.
const cache = new WeakMap<Contact[], ChatIndex>();

export function getChatIndex(data: ChatDataset): ChatIndex {
  const existing = cache.get(data.contacts);
  if (existing) return existing;
  const built = buildChatIndex(data);
  cache.set(data.contacts, built);
  return built;
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit 2>&1 | grep "ai-index"`
Expected: no output (no type errors referencing `ai-index.ts`).

> If `Pauta.contactId` / `Appointment.contactId` / `Message.contactId` are typed optional, `pushTo`'s `key: string | undefined` already handles it. If `Opportunity.contactId` is non-optional `string`, that's also fine.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-index.ts
git commit -m "feat: add contact-hub join index for AI tools"
```

---

## Task 2: Extract shared aggregate helpers (no behavior change)

**Files:**
- Modify: `lib/ai-tools.ts` (the `aggregate` function, currently ~lines 982-1041)

This is a pure refactor so `relate` (Task 3) can reuse the grouping/metric logic. The public behavior of the `aggregate` tool must not change.

- [ ] **Step 1: Replace the `aggregate` function with three functions**

Find the existing `function aggregate(input: ToolInput, data: ChatDataset) { ... }` block and replace it entirely with:

```ts
// Resolve an entity + filters to filtered rows. Shared by `aggregate` and `relate`.
function filteredRows(
  entity: string,
  filters: ToolInput,
  data: ChatDataset
): Array<Record<string, unknown>> {
  switch (entity) {
    case "contacts":
      return applyContactFilters(data.contacts, filters) as unknown as Array<Record<string, unknown>>;
    case "opportunities":
      return applyOppFilters(data.opportunities, filters) as unknown as Array<Record<string, unknown>>;
    case "pautas":
      return applyPautaFilters(data.pautas, filters) as unknown as Array<Record<string, unknown>>;
    case "appointments":
      return applyApptFilters(data.appointments, filters) as unknown as Array<Record<string, unknown>>;
    default:
      return [];
  }
}

// Group + metric over already-filtered rows. Shared by `aggregate` and `relate`.
function aggregateRows(
  rows: Array<Record<string, unknown>>,
  groupBy: string,
  metric: string,
  entity: string,
  limit: number
) {
  if (groupBy === "none") {
    return {
      groups: [{ key: "total", count: rows.length, ...metricValue(rows, metric, entity) }],
      total: rows.length,
    };
  }

  const buckets = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) {
    const raw = r[groupBy];
    if (groupBy === "tags" && Array.isArray(raw)) {
      if (raw.length === 0) push(buckets, "(sin tag)", r);
      for (const t of raw) push(buckets, String(t), r);
    } else {
      const key = raw === undefined || raw === null || raw === "" ? "(sin valor)" : String(raw);
      push(buckets, key, r);
    }
  }

  const groups = Array.from(buckets.entries())
    .map(([key, items]) => ({
      key,
      count: items.length,
      ...metricValue(items, metric, entity),
    }))
    .sort((a, b) => {
      const av = metric === "count" ? a.count : (a as { sum?: number; avg?: number }).sum ?? (a as { avg?: number }).avg ?? 0;
      const bv = metric === "count" ? b.count : (b as { sum?: number; avg?: number }).sum ?? (b as { avg?: number }).avg ?? 0;
      return bv - av;
    })
    .slice(0, limit);

  return { groups, total: rows.length, truncated: buckets.size > limit };
}

function aggregate(input: ToolInput, data: ChatDataset) {
  const entity = String(input.entity ?? "");
  const groupBy = String(input.groupBy ?? "none");
  const metric = String(input.metric ?? "count");
  const filters = (input.filters && typeof input.filters === "object" ? input.filters : {}) as ToolInput;
  const limit = clampLimit(input.limit, 50);

  if (!["contacts", "opportunities", "pautas", "appointments"].includes(entity)) {
    return { error: `Unknown entity: ${entity}` };
  }

  const rows = filteredRows(entity, filters, data);
  return aggregateRows(rows, groupBy, metric, entity, limit);
}
```

> Leave `push`, `metricValue`, and the `applyXFilters` helpers exactly as they are — they're reused unchanged.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "ai-tools"`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "refactor: extract filteredRows/aggregateRows shared helpers"
```

---

## Task 3: Add the `relate` executor and wire it in

**Files:**
- Modify: `lib/ai-tools.ts` (add import, helpers, `relate`, and the `executeTool` case)

- [ ] **Step 1: Add the `getChatIndex` import**

At the top of `lib/ai-tools.ts`, directly under the existing `import type { ... } from "@/lib/types";` block, add:

```ts
import { getChatIndex, type ChatIndex } from "@/lib/ai-index";
```

- [ ] **Step 2: Add the `relate` helpers and function**

Add this block immediately after the `aggregate` function (after Task 2's `aggregate`):

```ts
// ─── relate (cross-entity join through the shared contact) ──────────────────────

const RELATABLE = ["contacts", "opportunities", "pautas", "appointments"];

function contactIdOf(entity: string, row: Record<string, unknown>): string | undefined {
  if (entity === "contacts") return typeof row.id === "string" ? row.id : undefined;
  return typeof row.contactId === "string" ? row.contactId : undefined;
}

// Gather rows of `entity` whose contact is in `contactIds`, using the index.
function rowsForContacts(
  entity: string,
  contactIds: Set<string>,
  index: ChatIndex
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  switch (entity) {
    case "contacts":
      for (const id of contactIds) {
        const c = index.contactById.get(id);
        if (c) out.push(c as unknown as Record<string, unknown>);
      }
      break;
    case "opportunities":
      for (const id of contactIds) {
        const arr = index.oppsByContact.get(id);
        if (arr) for (const o of arr) out.push(o as unknown as Record<string, unknown>);
      }
      break;
    case "pautas":
      for (const id of contactIds) {
        const arr = index.pautasByContact.get(id);
        if (arr) for (const p of arr) out.push(p as unknown as Record<string, unknown>);
      }
      break;
    case "appointments":
      for (const id of contactIds) {
        const arr = index.apptsByContact.get(id);
        if (arr) for (const a of arr) out.push(a as unknown as Record<string, unknown>);
      }
      break;
  }
  return out;
}

function applyEntityFilters(
  entity: string,
  rows: Array<Record<string, unknown>>,
  filters: ToolInput
): Array<Record<string, unknown>> {
  switch (entity) {
    case "contacts":
      return applyContactFilters(rows as unknown as Contact[], filters) as unknown as Array<Record<string, unknown>>;
    case "opportunities":
      return applyOppFilters(rows as unknown as Opportunity[], filters) as unknown as Array<Record<string, unknown>>;
    case "pautas":
      return applyPautaFilters(rows as unknown as Pauta[], filters) as unknown as Array<Record<string, unknown>>;
    case "appointments":
      return applyApptFilters(rows as unknown as Appointment[], filters) as unknown as Array<Record<string, unknown>>;
    default:
      return rows;
  }
}

function relate(input: ToolInput, data: ChatDataset, index: ChatIndex) {
  const from = (input.from && typeof input.from === "object" ? input.from : {}) as ToolInput;
  const to = (input.to && typeof input.to === "object" ? input.to : {}) as ToolInput;
  const fromEntity = String(from.entity ?? "");
  const toEntity = String(to.entity ?? "");
  const metric = String(input.metric ?? "count");
  const groupBy = String(input.groupBy ?? "none");
  const includeContactIds = input.includeContactIds === true;
  const limit = clampLimit(input.limit, 50);

  if (!RELATABLE.includes(fromEntity)) return { error: `Unknown from.entity: ${fromEntity}` };
  if (!RELATABLE.includes(toEntity)) return { error: `Unknown to.entity: ${toEntity}` };

  const fromFilters = (from.filters && typeof from.filters === "object" ? from.filters : {}) as ToolInput;
  const toFilters = (to.filters && typeof to.filters === "object" ? to.filters : {}) as ToolInput;

  // 1. anchor set
  const fromRows = filteredRows(fromEntity, fromFilters, data);

  // 2. contacts of the anchor set
  const contactIds = new Set<string>();
  for (const r of fromRows) {
    const cid = contactIdOf(fromEntity, r);
    if (cid) contactIds.add(cid);
  }

  // 3. related rows via index, then 4. apply to-filters
  const related = rowsForContacts(toEntity, contactIds, index);
  const toRows = applyEntityFilters(toEntity, related, toFilters);

  // 5. aggregate
  const agg = aggregateRows(toRows, groupBy, metric, toEntity, limit);

  // distinct contacts present on BOTH sides (the join count)
  const matched = new Set<string>();
  for (const r of toRows) {
    const cid = contactIdOf(toEntity, r);
    if (cid) matched.add(cid);
  }

  const result: Record<string, unknown> = { ...agg, matchedContacts: matched.size };
  if (includeContactIds) result.contactIds = Array.from(matched).slice(0, limit);
  return result;
}
```

- [ ] **Step 3: Wire `relate` into `executeTool`**

In `executeTool`'s `switch (name)`, add this case directly before `case "show_in_panel":`:

```ts
    case "relate":
      return relate(input, data, getChatIndex(data));
```

- [ ] **Step 4: Type-check (also confirms no import cycle)**

Run: `npx tsc --noEmit 2>&1 | grep -E "ai-tools|ai-index"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat: add relate cross-entity join executor"
```

---

## Task 4: Add the `relate` tool definition

**Files:**
- Modify: `lib/ai-tools.ts` (`TOOL_DEFINITIONS` array)

- [ ] **Step 1: Add the tool schema**

In the `TOOL_DEFINITIONS` array, add this object immediately before the `show_in_panel` definition (the last entry):

```ts
  {
    name: "relate",
    description:
      "Cross-entity join through the shared contact — THE one tool for any question that links appointments, pautas, opportunities, or contacts to each other (e.g. '¿cuánto valen las citas de mayo?', '¿qué ventas ganadas vinieron de la pauta X?'). It filters the `from` set, hops to the SAME contacts' `to` records, applies `to` filters, and aggregates — all in ONE call. NEVER hand-roll this by extracting contactIds and calling aggregate/search yourself; that is slow and expensive. Returns { groups, total, matchedContacts, contactIds? }. matchedContacts = distinct contacts that have BOTH a `from` and a `to` record.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "object",
          description: "Anchor set. { entity, filters? }.",
          properties: {
            entity: {
              type: "string",
              enum: ["contacts", "opportunities", "pautas", "appointments"],
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description:
                "Same filter keys as search_<entity>/aggregate. Appointments: status, assignedTo, startAfter, startBefore. Pautas: tipo, contactId. Opportunities: status, source, assignedTo, stage, pipeline, priority, archived, minValue, maxValue, minProbability, maxProbability, createdAfter, createdBefore, closedAfter, closedBefore. Contacts: source, campaign, adType, assignedTo, tags, companyName, city, state, country, dnd, createdAfter, createdBefore.",
            },
          },
          required: ["entity"],
        },
        to: {
          type: "object",
          description: "Related set, reached via the shared contact. { entity, filters? }.",
          properties: {
            entity: {
              type: "string",
              enum: ["contacts", "opportunities", "pautas", "appointments"],
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Same filter keys as search_<entity>/aggregate (see from.filters).",
            },
          },
          required: ["entity"],
        },
        metric: {
          type: "string",
          enum: ["count", "sum", "avg"],
          description: "Aggregation over the `to` set. 'sum'/'avg' apply to opportunity.value only. Use 'count' otherwise.",
        },
        groupBy: {
          type: "string",
          description:
            "Optional field on the `to` entity to group by (e.g. 'status', 'stage', 'source', 'assignedTo'). Omit (or 'none') for a single total.",
        },
        includeContactIds: {
          type: "boolean",
          description:
            "When true, also returns the matched contactIds (capped at `limit`) so you can chain show_in_panel or a live per-contact fetch (get_contact_tasks/get_contact_notes/get_contact_messages). Default false — leave off for pure numeric questions to keep the response small.",
        },
        limit: {
          type: "number",
          description: "Max groups and max contactIds returned (default 50).",
        },
      },
      required: ["from", "to", "metric"],
    },
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "ai-tools"`
Expected: no output. (`TOOL_DEFINITIONS` is `as const`; `ToolName` will now include `"relate"`.)

- [ ] **Step 3: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat: add relate tool definition to TOOL_DEFINITIONS"
```

---

## Task 5: Thin opportunity rollups on appointment/pauta rows

**Files:**
- Modify: `lib/ai-tools.ts` (`compactAppt`, `compactPauta`, `listAppointments`, `searchPautas`, `getContactRelated`, `executeTool`)

- [ ] **Step 1: Add the rollup helper and update the compact mappers**

Add `oppRollup` directly above the existing `compactAppt` function, then replace `compactAppt` and `compactPauta` with the index-aware versions:

```ts
function oppRollup(
  contactId: string | undefined,
  index: ChatIndex
): { oppCount: number; oppValueSum: number } {
  if (!contactId) return { oppCount: 0, oppValueSum: 0 };
  const opps = index.oppsByContact.get(contactId) ?? [];
  let sum = 0;
  for (const o of opps) sum += typeof o.value === "number" ? o.value : 0;
  return { oppCount: opps.length, oppValueSum: sum };
}

function compactAppt(a: Appointment, index: ChatIndex) {
  return {
    id: a.id,
    contactId: a.contactId,
    assignedTo: a.assignedTo,
    title: a.title,
    startTime: a.startTime,
    status: a.status,
    location: a.location,
    ...oppRollup(a.contactId, index),
  };
}

function compactPauta(p: Pauta, index: ChatIndex) {
  return {
    id: p.id,
    tipo: p.tipo,
    nombre: p.nombrePauta,
    contactId: p.contactId,
    createdAt: p.createdAt,
    ...oppRollup(p.contactId, index),
  };
}
```

- [ ] **Step 2: Update `listAppointments` to take and use the index**

Change the signature and the `.map(compactAppt)` call:

```ts
function listAppointments(input: ToolInput, data: ChatDataset, index: ChatIndex) {
```

and at its return:

```ts
  return {
    rows: out.map((a) => compactAppt(a, index)),
    returned: out.length,
    truncated: out.length >= limit,
  };
```

- [ ] **Step 3: Update `searchPautas` to take and use the index**

Change the signature and the `.map(compactPauta)` call:

```ts
function searchPautas(input: ToolInput, data: ChatDataset, index: ChatIndex) {
```

and at its return:

```ts
  return {
    rows: out.map((p) => compactPauta(p, index)),
    returned: out.length,
    truncated: out.length >= limit,
  };
```

- [ ] **Step 4: Update `getContactRelated` to take and use the index**

Change the signature:

```ts
function getContactRelated(input: ToolInput, data: ChatDataset, index: ChatIndex) {
```

and update its `pautas` and `appointments` maps (leave `opportunities` and `messages` as-is):

```ts
  if (kinds.includes("pautas")) {
    result.pautas = data.pautas
      .filter((p) => p.contactId === id)
      .map((p) => compactPauta(p, index));
  }
  if (kinds.includes("appointments")) {
    result.appointments = data.appointments
      .filter((a) => a.contactId === id)
      .map((a) => compactAppt(a, index));
  }
```

- [ ] **Step 5: Update the three `executeTool` cases to pass the index**

In `executeTool`'s `switch`, change these three cases:

```ts
    case "get_contact_related":
      return getContactRelated(input, data, getChatIndex(data));
    case "search_pautas":
      return searchPautas(input, data, getChatIndex(data));
    case "list_appointments":
      return listAppointments(input, data, getChatIndex(data));
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "ai-tools"`
Expected: no output. (Confirms every `compactAppt`/`compactPauta` call site now passes the index.)

- [ ] **Step 7: Commit**

```bash
git add lib/ai-tools.ts
git commit -m "feat: add oppCount/oppValueSum rollups to appointment and pauta rows"
```

---

## Task 6: Rewrite the system prompts

**Files:**
- Modify: `lib/ai-context.ts` (`CHAT_SYSTEM_PROMPT` ~lines 157-169; `CONVERSATIONS_SYSTEM_PROMPT` strategy section)

> In these template literals, inline code is written with escaped backticks (`` \` ``). Preserve that escaping in the replacement text.

- [ ] **Step 1: Replace the cross-entity join section in `CHAT_SYSTEM_PROMPT`**

Replace the section that begins with `## Cross-entity joins — siempre van por el contacto` and ends just before `- Los contactos incluyen:` (the manual 3-step pattern and its example) with:

```
## Cruces entre entidades — usa \`relate\` (UNA sola llamada)

**Regla fundamental**: citas, pautas y mensajes NO tienen valor propio. Su valor está en las oportunidades del contacto al que pertenecen. El contacto es el nodo central que conecta todo.

Para CUALQUIER pregunta que cruce entidades (citas↔oportunidades, pautas↔oportunidades, citas↔pautas, contactos↔oportunidades, etc.) usa **\`relate\` en UNA sola llamada**. NUNCA extraigas contactIds manualmente ni hagas el cruce con varias llamadas — es lento y caro. \`relate\` filtra el conjunto \`from\`, salta a los registros \`to\` de los mismos contactos, aplica los filtros de \`to\` y agrega, todo de una vez.

Ejemplos:
- "¿cuánto valen las citas de mayo?" → \`relate({ from: { entity: "appointments", filters: { startAfter: "2026-05-01", startBefore: "2026-05-31" } }, to: { entity: "opportunities" }, metric: "sum" })\`
- "¿qué ventas ganadas vinieron de la pauta X?" → \`relate({ from: { entity: "pautas", filters: { tipo: "X" } }, to: { entity: "opportunities", filters: { status: "won" } }, metric: "sum" })\`
- "citas por etapa de la oportunidad" → \`relate({ from: { entity: "appointments" }, to: { entity: "opportunities" }, metric: "count", groupBy: "stage" })\`

\`relate\` devuelve { groups, total, matchedContacts }. \`matchedContacts\` = contactos distintos con registro en AMBOS lados. NUNCA aproximes con \`createdAfter/createdBefore\` de la oportunidad para responder "valor de las citas" — eso filtra por fecha de la oportunidad, no de la cita; usa \`relate\`.

**Rollups en filas (solo contexto)**: \`list_appointments\` y \`search_pautas\` traen \`oppCount\` y \`oppValueSum\` por fila (oportunidades del contacto de esa fila) ÚNICAMENTE como contexto visual. NUNCA sumes \`oppValueSum\` entre filas para un total — un contacto con 2 citas se contaría doble. Para totales usa SIEMPRE \`relate\`.

**Tareas, notas y mensajes completos** no están indexados en bloque (límite de la API de GHL). Para "citas que también tienen tareas" y similares: primero acota con \`relate({ ..., includeContactIds: true })\`, luego llama las herramientas en vivo (\`get_contact_tasks\`/\`get_contact_notes\`/\`get_contact_messages\`) solo para ese conjunto.
```

- [ ] **Step 2: Add a `relate` bullet to `CONVERSATIONS_SYSTEM_PROMPT`**

In `CONVERSATIONS_SYSTEM_PROMPT`, under `# Estrategia de herramientas para conversaciones`, add this as the first bullet of that list:

```
- **Cruces entre entidades** (p.ej. contactos con oportunidad abierta, citas con ventas): usa \`relate\` en UNA sola llamada — nunca extraigas contactIds a mano. Para acotar y luego traer tareas/notas/mensajes en vivo, usa \`relate({ ..., includeContactIds: true })\` y pasa esos contactIds a las herramientas en vivo o a \`show_in_panel\`.
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "ai-context"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/ai-context.ts
git commit -m "docs: rewrite AI prompts to mandate relate for cross-entity joins"
```

---

## Task 7: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Full type-check across the changed files**

Run: `npx tsc --noEmit 2>&1 | grep -E "ai-index|ai-tools|ai-context"`
Expected: no output.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: server on `localhost:3000`, no compile errors in the terminal.

- [ ] **Step 3: Exercise `relate` from the AI chat**

Open the AI chat and run each prompt; confirm each resolves in a SINGLE `relate` tool call (watch the tool-execution status / counter in `use-agent-loop`), and that no raw contactId arrays appear in the transcript unless `includeContactIds` was needed:

- "¿cuánto valen las citas de mayo?" → expect one `relate(from=appointments[May], to=opportunities, metric=sum)`.
- "¿qué ventas ganadas vinieron de la pauta <un tipo real>?" → expect one `relate(from=pautas[...], to=opportunities[status=won], metric=sum)`.
- "muéstrame los contactos cuyas citas terminaron en venta ganada" → expect `relate(..., includeContactIds:true)` followed by `show_in_panel`.

- [ ] **Step 4: Cross-check correctness against the old path**

For "¿cuánto valen las citas de mayo?", manually verify the `relate` sum matches the equivalent two-step result: run `list_appointments(startAfter, startBefore)`, then `aggregate(entity="opportunities", metric="sum", filters={contactIds:[...]})` with those contacts. The totals must match.

- [ ] **Step 5: Confirm the loop is shorter**

Confirm via the chat's turn/tool counters that the cross-entity question now costs ONE tool turn (plus the final text turn), versus the previous 3-4 turns, and that the token usage is materially lower.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verify relate cross-entity join end-to-end"
```

> If Step 3 or 4 reveals a bug, use superpowers:systematic-debugging before patching.
