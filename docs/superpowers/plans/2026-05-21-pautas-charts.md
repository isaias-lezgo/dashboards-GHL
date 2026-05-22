# Pautas Charts — Marketing Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two horizontal bar charts to the Marketing dashboard that show Pautas custom object records grouped by "Tipo" and by "Nombre pauta" (top 30), fetched from the GHL Custom Objects API with dynamic schema discovery.

**Architecture:** Pautas are fetched inside the existing NDJSON streaming route, running concurrently with contacts and opportunities. A new `Pauta` internal type flows through `ghl-client → API route → DashboardData hook → page → MarketingDashboard`, matching the established data pipeline pattern exactly.

**Tech Stack:** Next.js 15 App Router, TypeScript, Recharts (via shadcn `ChartContainer`), GHL Custom Objects API v2 (`2023-02-21`).

> **Note:** This project has no automated test suite. TypeScript compilation (`npx tsc --noEmit`) and browser inspection are the verification steps.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/ghl-client.ts` | Modify | Add version override to ghlFetch; add Custom Objects interfaces + `getCustomObjects()` + `getAllCustomObjectRecords()` |
| `lib/types.ts` | Modify | Add `Pauta` interface |
| `hooks/use-dashboard-data.ts` | Modify | Add `pautas: Pauta[]` to `DashboardData` |
| `app/api/dashboard/route.ts` | Modify | Add `fetchAllPautas()` helper; start concurrently; include in stream payload |
| `app/page.tsx` | Modify | Pass `pautas` prop to `MarketingDashboard` |
| `components/dashboard/marketing-dashboard.tsx` | Modify | Add `pautas` prop, two `useMemo` derivations, two horizontal bar charts |

---

### Task 1: Extend GHL client with version override and Custom Objects functions

**Files:**
- Modify: `lib/ghl-client.ts`

- [ ] **Step 1: Add `version` field to `GHLRequestOptions`**

Locate the `GHLRequestOptions` interface (line ~10) and add the new field:

```ts
interface GHLRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
  useSnakeCaseLocationId?: boolean;
  version?: string;
}
```

- [ ] **Step 2: Use `version` override in `ghlFetch` headers**

Inside `ghlFetch`, find the `headers` block and change the `Version` line:

```ts
// Before:
Version: GHL_API_VERSION,

// After:
Version: options.version ?? GHL_API_VERSION,
```

- [ ] **Step 3: Add Custom Objects interfaces**

Append after the `// ============ CUSTOM VALUES / LOST REASONS ============` section:

```ts
// ============ CUSTOM OBJECTS ============

export interface GHLCustomObjectField {
  key: string;
  label: string;
  dataType: string;
}

export interface GHLCustomObjectSchema {
  key: string;
  labels: { singular: string; plural: string };
  fields: GHLCustomObjectField[];
}

export interface GHLCustomObjectsResponse {
  customObjects: GHLCustomObjectSchema[];
}

export interface GHLCustomObjectRecord {
  id: string;
  properties: Record<string, string | string[] | null>;
  dateAdded?: string;
  createdAt?: string;
}

export interface GHLCustomObjectRecordsResponse {
  records: GHLCustomObjectRecord[];
  total?: number;
  page?: number;
  pageCount?: number;
  nextPage?: number | null;
}
```

- [ ] **Step 4: Add `getCustomObjects()` function**

```ts
export async function getCustomObjects(): Promise<GHLCustomObjectsResponse> {
  return ghlFetch<GHLCustomObjectsResponse>("/custom-objects/", {
    version: "2023-02-21",
  });
}
```

- [ ] **Step 5: Add `getAllCustomObjectRecords()` function**

```ts
export async function getAllCustomObjectRecords(
  objectKey: string,
  onProgress?: (count: number) => void
): Promise<GHLCustomObjectRecord[]> {
  const allRecords: GHLCustomObjectRecord[] = [];
  let page = 1;

  while (true) {
    const response = await ghlFetch<GHLCustomObjectRecordsResponse>(
      `/custom-objects/${objectKey}/records`,
      {
        version: "2023-02-21",
        params: { limit: 100, page },
      }
    );

    allRecords.push(...response.records);
    onProgress?.(allRecords.length);

    const hasMore =
      response.nextPage != null ||
      (response.total !== undefined && allRecords.length < response.total);

    if (!hasMore || response.records.length < 100) break;

    page = (response.nextPage as number) ?? page + 1;
    await sleep(200);
  }

  return allRecords;
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors from `lib/ghl-client.ts`.

- [ ] **Step 7: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add lib/ghl-client.ts && git commit -m "feat: add GHL Custom Objects API client with version override"
```

---

### Task 2: Add `Pauta` internal type

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Append `Pauta` interface to `lib/types.ts`**

```ts
export interface Pauta {
  id: string
  tipo: string
  nombrePauta: string
  createdAt: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add lib/types.ts && git commit -m "feat: add Pauta internal type"
```

---

### Task 3: Add `pautas` to `DashboardData` interface

**Files:**
- Modify: `hooks/use-dashboard-data.ts`

- [ ] **Step 1: Add `Pauta` to the type import**

```ts
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Message,
  Pipeline,
  Pauta,
} from "@/lib/types";
```

- [ ] **Step 2: Add `pautas` field to `DashboardData`**

```ts
export interface DashboardData {
  contacts: Contact[];
  opportunities: Opportunity[];
  calls: Call[];
  tasks: Task[];
  messages: Message[];
  pipelines: Pipeline[];
  members: string[];
  tags: string[];
  campaigns: string[];
  sources: string[];
  pautas: Pauta[];
  meta: {
    totalContacts: number;
    totalOpportunities: number;
    totalMessages: number;
    fetchedAt: string;
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: TypeScript may warn that `pautas` is missing from the API route payload — that's resolved in Task 4.

- [ ] **Step 4: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add hooks/use-dashboard-data.ts && git commit -m "feat: add pautas to DashboardData interface"
```

---

### Task 4: Fetch pautas in the API route and include in stream

**Files:**
- Modify: `app/api/dashboard/route.ts`

- [ ] **Step 1: Add new imports to the route**

Replace the existing import block at the top of `app/api/dashboard/route.ts`:

```ts
import {
  getAllContacts,
  getAllOpportunities,
  getPipelines,
  getConversations,
  getMessages,
  getUsers,
  getLostReasons,
  getCustomObjects,
  getAllCustomObjectRecords,
  type GHLContact,
  type GHLOpportunity,
  type GHLConversation,
  type GHLMessage,
} from "@/lib/ghl-client";
import type {
  Contact,
  Opportunity,
  Call,
  Task,
  Message,
  Pipeline,
  Pauta,
} from "@/lib/types";
```

- [ ] **Step 2: Add `fetchAllPautas()` helper above the `GET` export**

```ts
async function fetchAllPautas(): Promise<Pauta[]> {
  try {
    const schemasResp = await getCustomObjects();
    const schema = schemasResp.customObjects.find(
      (s) =>
        s.labels.singular.toLowerCase().includes("pauta") ||
        s.labels.plural.toLowerCase().includes("pautas")
    );
    if (!schema) {
      console.warn("[GHL] Pautas custom object schema not found");
      return [];
    }
    const tipoField = schema.fields.find(
      (f) => f.label.toLowerCase() === "tipo"
    );
    const nombreField = schema.fields.find(
      (f) => f.label.toLowerCase() === "nombre pauta"
    );
    const records = await getAllCustomObjectRecords(schema.key);
    return records.map((r) => ({
      id: r.id,
      tipo:
        (tipoField ? String(r.properties[tipoField.key] ?? "") : "") ||
        "Sin tipo",
      nombrePauta:
        (nombreField ? String(r.properties[nombreField.key] ?? "") : "") ||
        "Sin nombre",
      createdAt: r.dateAdded ?? r.createdAt ?? new Date().toISOString(),
    }));
  } catch (err) {
    console.error("[GHL] Pautas fetch failed:", err);
    return [];
  }
}
```

- [ ] **Step 3: Start `pautasPromise` concurrently after the first `Promise.allSettled` block**

Inside `GET` → `start(controller)`, find the line:

```ts
send({ type: "progress", message: "Cargando pipelines y configuración…" });
```

Immediately after it, add:

```ts
// Start pautas fetch concurrently — runs while contacts/opportunities load
const pautasPromise = fetchAllPautas();
```

- [ ] **Step 4: Await pautas after opportunities are fetched**

Find the line:

```ts
send({ type: "progress", message: "Procesando datos…" });
```

Immediately before it, add:

```ts
send({ type: "progress", message: "Cargando pautas…" });
const pautas = await pautasPromise;
```

- [ ] **Step 5: Include `pautas` in the final `send` payload**

Find the final `send({ type: "data", ... })` call and add `pautas` to it:

```ts
send({
  type: "data",
  contacts,
  opportunities,
  calls,
  tasks,
  messages,
  pipelines: pipelineList,
  members,
  tags: Array.from(tagSet),
  campaigns: Array.from(campaignSet),
  sources: Array.from(sourceSet),
  pautas,
  meta: {
    totalContacts: contacts.length,
    totalOpportunities: opportunities.length,
    totalMessages: messages.length,
    fetchedAt: new Date().toISOString(),
    debugAttribution,
  },
});
```

- [ ] **Step 6: Verify TypeScript compiles with no errors**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add app/api/dashboard/route.ts && git commit -m "feat: fetch Pautas custom object records in dashboard stream"
```

---

### Task 5: Pass `pautas` prop through `page.tsx` and add charts to `MarketingDashboard`

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/dashboard/marketing-dashboard.tsx`

- [ ] **Step 1: Add `pautas` prop to `MarketingDashboard` in `page.tsx`**

Find the `<MarketingDashboard ... />` JSX and update it:

```tsx
<MarketingDashboard
  opportunities={filteredOpportunities}
  contacts={filteredContacts}
  pautas={data?.pautas ?? []}
/>
```

- [ ] **Step 2: Add `Pauta` to the import in `marketing-dashboard.tsx`**

```ts
import type { Opportunity, Contact, Pauta } from "@/lib/types"
```

- [ ] **Step 3: Add `FileText` to the lucide-react import**

```ts
import { Megaphone, Globe, BarChart3, Layers, TrendingDown, Tag, FileText } from "lucide-react"
```

- [ ] **Step 4: Update `MarketingDashboardProps` and function signature**

```ts
interface MarketingDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  pautas: Pauta[]
}

export function MarketingDashboard({ opportunities, contacts, pautas }: MarketingDashboardProps) {
```

- [ ] **Step 5: Add `pautasByTipo` derivation inside the component**

Add after the existing `useMemo` blocks:

```ts
const pautasByTipo = useMemo(() => {
  const counts = new Map<string, number>()
  for (const p of pautas) {
    counts.set(p.tipo, (counts.get(p.tipo) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tipo, count]) => ({ tipo, count }))
}, [pautas])
```

- [ ] **Step 6: Add `pautasByNombre` derivation (top 30)**

```ts
const pautasByNombre = useMemo(() => {
  const counts = new Map<string, number>()
  for (const p of pautas) {
    counts.set(p.nombrePauta, (counts.get(p.nombrePauta) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([nombre, count]) => ({ nombre, count }))
}, [pautas])
```

- [ ] **Step 7: Add Row 5 — Pautas charts — at the bottom of the returned JSX**

Add inside the outer `<div className="flex flex-col gap-4 px-6 pb-6">`, after the closing `</Card>` of the Embudo Paid Social section:

```tsx
{/* Row 5: Pautas por Tipo + Pautas por Nombre Pauta */}
<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

  {/* Pautas por Tipo */}
  <Card className="shadow-sm">
    <CardHeader className="flex flex-row items-center gap-2 pb-2">
      <FileText className={iconCls} />
      <CardTitle className="text-sm font-semibold">Pautas por Tipo</CardTitle>
      <TotalBadge value={pautas.length} />
    </CardHeader>
    <CardContent>
      {pautasByTipo.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          Sin datos de Pautas.
        </div>
      ) : (
        <ChartContainer
          config={{ count: { label: "Pautas", color: "#2563eb" } }}
          className="aspect-auto"
          style={{ height: Math.max(220, pautasByTipo.length * 44 + 20) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={pautasByTipo}
              margin={{ top: 5, right: 30, left: 8, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="tipo"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={150}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => p?.[0]?.payload?.tipo ?? String(_)}
                  />
                }
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} name="Pautas" maxBarSize={32}>
                {pautasByTipo.map((entry, i) => (
                  <Cell key={entry.tipo} fill={barColor(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}
    </CardContent>
  </Card>

  {/* Pautas por Nombre Pauta */}
  <Card className="shadow-sm">
    <CardHeader className="flex flex-row items-center gap-2 pb-2">
      <FileText className={iconCls} />
      <CardTitle className="text-sm font-semibold">Pautas por Nombre (Top 30)</CardTitle>
      <TotalBadge value={pautas.length} />
    </CardHeader>
    <CardContent>
      {pautasByNombre.length === 0 ? (
        <div className="flex h-[520px] items-center justify-center text-sm text-muted-foreground">
          Sin datos de Pautas.
        </div>
      ) : (
        <ChartContainer
          config={{ count: { label: "Pautas", color: "#2563eb" } }}
          className="aspect-auto"
          style={{ height: Math.max(300, pautasByNombre.length * 28 + 20) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={pautasByNombre}
              margin={{ top: 5, right: 30, left: 8, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="nombre"
                tick={{ fontSize: 10, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={180}
                tickFormatter={(v: string) => v.length > 26 ? v.slice(0, 26) + "…" : v}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => p?.[0]?.payload?.nombre ?? String(_)}
                  />
                }
              />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} name="Pautas" maxBarSize={22}>
                {pautasByNombre.map((entry, i) => (
                  <Cell key={entry.nombre} fill={barColor(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}
    </CardContent>
  </Card>

</div>
```

- [ ] **Step 8: Verify TypeScript compiles with no errors**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && git add app/page.tsx components/dashboard/marketing-dashboard.tsx && git commit -m "feat: add Pautas por Tipo and Pautas por Nombre charts to Marketing dashboard"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Start dev server**

```bash
cd "/Users/isaiasrios/Software/DASHBOARDS GHL CLAUDE" && npm run dev
```

- [ ] **Step 2: Open browser at `http://localhost:3000`**

On the Marketing tab, observe:
- Progress banner shows `"Cargando pautas…"` during load.
- After load, scroll to bottom — two new charts appear in a 2-column grid.
- **"Pautas por Tipo"**: horizontal bars, one per Tipo value (e.g., "Mensaje WhatsApp"). Bars colored by palette. TotalBadge shows total pautas count.
- **"Pautas por Nombre (Top 30)"**: horizontal bars, up to 30, long names truncated. Tooltip shows full name on hover. TotalBadge shows total pautas count.
- If GHL custom objects API returns no Pautas schema: charts show "Sin datos de Pautas." empty state — no crash.

- [ ] **Step 3: Verify no console errors**

Open DevTools → Console. No red errors related to pautas, Recharts, or missing props.

- [ ] **Step 4: If API version 2023-02-21 fails for custom-objects endpoints**

If you see a 404 or 401 on `/custom-objects/` in the network tab, try changing the version in `getAllCustomObjectRecords` and `getCustomObjects` calls in `lib/ghl-client.ts` back to `"2021-07-28"` and reload.
