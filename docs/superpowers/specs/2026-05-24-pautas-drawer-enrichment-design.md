# Pautas Drawer Enrichment — Design Spec

**Date:** 2026-05-24  
**Status:** Approved

## Summary

When the user clicks a bar on either Pautas chart ("Pautas por Tipo" or "Pautas por Nombre"), the `ChartDrillDrawer` opens and shows a list of matching Pauta records. Currently each card only shows `nombrePauta`, `tipo`, and `createdAt`.

This spec enriches each card with:
1. All available Pauta properties (including date fields)
2. The Contact linked to that Pauta via a GHL association
3. All Opportunities belonging to that Contact

---

## Data Model Changes

### `Pauta` (`lib/types.ts`)

Add two optional fields:

```ts
export interface Pauta {
  id: string
  tipo: string
  nombrePauta: string
  createdAt: string
  contactId?: string                        // NEW — extracted from GHL association
  properties?: Record<string, string>       // NEW — all raw property fields (non-null)
}
```

### `GHLCustomObjectRecord` (`lib/ghl-client.ts`)

Add `associations` to capture whatever shape GHL returns:

```ts
export interface GHLCustomObjectRecord {
  id: string
  properties: Record<string, string | string[] | null>
  createdAt?: string
  updatedAt?: string
  associations?: Record<string, unknown>    // NEW
}
```

---

## Server Changes (`app/api/dashboard/route.ts`)

Inside `fetchAllPautas()`, after mapping `r.properties`:

1. **Extract `contactId`** from `r.associations` by trying these candidate keys in order:
   - `r.associations?.contact` (string)
   - `r.associations?.contacts` (string or first element of array)
   - `r.associations?.["contact"]` normalized variant
   If none resolves, `contactId` is `undefined`.

2. **Log the raw association shape** from the first record only (once per fetch) so we can verify the correct key at runtime.

3. **Map all properties** to `Record<string, string>`: iterate `r.properties`, skip `null`/empty values, coerce arrays to comma-joined strings.

Return the enriched `Pauta` object:
```ts
{
  id: r.id,
  tipo: ...,
  nombrePauta: ...,
  createdAt: r.createdAt ?? ...,
  contactId: resolvedContactId,
  properties: mappedProperties,
}
```

---

## Drawer UI Changes (`components/dashboard/chart-drill-drawer.tsx`)

### `PautasList` signature change

```ts
function PautasList({
  pautas,
  contacts,
  allOpportunities,
}: {
  pautas: Pauta[]
  contacts: Contact[]
  allOpportunities: Opportunity[]
})
```

`ChartDrillDrawer` already receives `contacts` and `allOpportunities` as props — pass both down to `PautasList`.

### Card layout

Each card is divided into three sections separated by a subtle border:

**Pauta section**
- Header: `FileText` icon + `nombrePauta` (bold) + `[tipo]` badge
- `createdAt` formatted as `dd/MM/yyyy`
- All entries from `p.properties` rendered as `key: value` chips (skip fields already shown: `tipo`, `nombre_pauta`; skip empty strings)

**Contact section** (conditional on `p.contactId` resolving to a Contact)
- `User` icon + contact name (semibold)
- Email and phone on a secondary line with `Mail`/`Phone` icons
- If `contactId` is set but no matching contact found in `contacts[]`: show muted "Contacto no encontrado"
- If `contactId` is undefined: show muted "Sin contacto asociado"

**Opportunities section** (conditional on contact being found)
- Each opportunity shown as a compact row: name · `[stage badge]` · `$value`
- Sort order: `open` first, then `won`, then `lost`/`abandoned`
- If contact found but no opportunities: show muted "Sin oportunidades"

### No click-through needed
Pauta cards are display-only (no drill-deeper). The existing `DetailDrawer` for opportunities is not triggered from here.

---

## Constraints & Edge Cases

- **Null associations:** If GHL doesn't return `associations` in the records/search response at all, `contactId` will be `undefined` for all pautas. The drawer degrades gracefully (shows "Sin contacto asociado"). A console warning is emitted once so the dev can check the raw shape.
- **Multiple contacts per pauta:** If GHL returns an array, use the first element only.
- **Properties display:** Known internal keys (`tipo`, `nombre_pauta`, `id`) are excluded from the "all properties" chip list to avoid duplication. Empty/null values are skipped.
- **Performance:** No new API calls are introduced. Contact and opportunity lookup is pure client-side filtering against already-fetched arrays.
