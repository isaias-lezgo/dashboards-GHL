# Pautas Charts — Marketing Dashboard

**Date:** 2026-05-21  
**Status:** Approved

## Overview

Add two charts to the Marketing dashboard that visualize data from the "Pautas" GHL custom object. Pautas are ad/content records with a "Tipo" (type) and "Nombre pauta" (ad name) field. The goal is to show distribution by type and by name.

---

## 1. GHL Client Layer (`lib/ghl-client.ts`)

### New interfaces

```ts
interface GHLCustomObjectField {
  key: string
  label: string
  dataType: string
}

interface GHLCustomObjectSchema {
  key: string           // e.g. "custom_objects.pautas" or a UUID slug
  labels: { singular: string; plural: string }
  fields: GHLCustomObjectField[]
}

interface GHLCustomObjectRecord {
  id: string
  properties: Record<string, string | string[] | null>
  dateAdded: string
}
```

### New functions

**`getCustomObjects()`**  
`GET /custom-objects/?locationId=...`  
Returns all custom object schemas for the location. Used once at startup to discover the Pautas object key and its field keys.

**`getAllCustomObjectRecords(objectKey, fieldKeys)`**  
`GET /custom-objects/{objectKey}/records?locationId=...&limit=100`  
Paginated fetch. Returns all records. Uses the existing `ghlFetch` wrapper. Custom Objects endpoints may require `Version: 2023-02-21` — if so, pass it as an override in `ghlFetch` options rather than changing the global constant. Pagination shape (cursor vs. page offset) must be confirmed from the live API response; implement defensively to handle both.

Discovery logic:
- Find schema where `labels.singular.toLowerCase()` includes `"pauta"` or `labels.plural.toLowerCase()` includes `"pautas"`.
- From that schema's `fields`, find the field with `label === "Tipo"` → `tipoKey`.
- Find the field with `label === "Nombre pauta"` → `nombrePautaKey`.
- If discovery fails, log a warning and return an empty array (graceful degradation).

---

## 2. Internal Types (`lib/types.ts`)

```ts
export interface Pauta {
  id: string
  tipo: string        // value of "Tipo" field; defaults to "Sin tipo" if missing
  nombrePauta: string // value of "Nombre pauta" field; defaults to "Sin nombre" if missing
  createdAt: string
}
```

---

## 3. API Route (`app/api/dashboard/route.ts`)

Pautas fetch runs concurrently with pipelines/users/lostReasons in the first `Promise.allSettled` batch. Order: pipelines, users, lostReasons, **pautas**.

Steps:
1. `getCustomObjects()` → find schema → extract `objectKey`, `tipoKey`, `nombrePautaKey`.
2. `getAllCustomObjectRecords(objectKey)` → paginate until exhausted.
3. Map each record → `Pauta` using the discovered field keys.
4. Add progress message: `"Cargando pautas…"`.
5. On failure (API error or schema not found), log and include `pautas: []` — never throws.
6. Include `pautas` in the final `send({ type: "data", ... })` payload.

---

## 4. Hook (`hooks/use-dashboard-data.ts`)

Add `pautas: Pauta[]` to the `DashboardData` interface. No other changes.

---

## 5. Page (`app/page.tsx`)

Pass pautas to `MarketingDashboard`:

```tsx
<MarketingDashboard
  opportunities={filteredOpportunities}
  contacts={filteredContacts}
  pautas={data?.pautas ?? []}
/>
```

No mock data fallback needed for pautas — empty array is the correct default.

---

## 6. Marketing Dashboard (`components/dashboard/marketing-dashboard.tsx`)

### New prop

```ts
interface MarketingDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  pautas: Pauta[]       // new
}
```

### New data derivations (useMemo)

**`pautasByTipo`**  
Count pautas by `tipo`. All values shown (expected to be a small set like "Mensaje WhatsApp", "Video", etc.). Sorted descending by count.

**`pautasByNombre`**  
Count pautas by `nombrePauta`. Top 30 by count, sorted descending.

### New charts — Row 5 (new row at bottom)

Both charts use `BarLayout="vertical"` (horizontal bars) so long names don't require rotation. They sit in a 2-column grid matching the existing layout.

**Chart A: Pautas por Tipo**
- Horizontal bar chart
- `dataKey="tipo"` on Y-axis, `dataKey="count"` on X-axis
- Each bar colored by `BAR_PALETTE`
- `TotalBadge` shows `pautas.length`
- Empty state: "Sin datos de Pautas." if `pautas.length === 0`
- Height: 220px (few expected categories)

**Chart B: Pautas por Nombre Pauta**
- Horizontal bar chart, top 30
- `dataKey="nombre"` on Y-axis (truncated to 28 chars with `…`), `dataKey="count"` on X-axis
- Each bar colored by `BAR_PALETTE`
- `TotalBadge` shows `pautas.length`
- Tooltip shows full name
- Empty state: "Sin datos de Pautas." if `pautas.length === 0`
- Height: 520px (accommodates up to 30 bars legibly)

---

## Error Handling

- If GHL custom objects API returns a non-200: caught by `Promise.allSettled`, `pautas: []` returned.
- If "Pautas" schema is not found: warning logged, `pautas: []`.
- If a record is missing "Tipo" or "Nombre pauta": defaults to `"Sin tipo"` / `"Sin nombre"`.

---

## Out of Scope

- Filtering pautas by date range, pipeline, or member (pautas are not linked to the existing filter system).
- Displaying a pautas detail table or drill-down.
- Mock data for pautas (empty array is the fallback).
