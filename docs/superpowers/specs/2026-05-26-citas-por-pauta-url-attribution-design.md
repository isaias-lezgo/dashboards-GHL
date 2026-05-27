# Design: Citas por Pauta (URL Attribution)

**Date:** 2026-05-26  
**Status:** Approved

## Summary

Add a full-width vertical stacked bar chart to the Marketing Dashboard showing how many appointments each pauta generated, attributed via URL matching between the contact's `attributionUrl` and the URL embedded in the pauta name.

## Context

The Marketing Dashboard already has:
- `Pauta` records with `nombrePauta` in format `"HEADLINE - URL - NUMERIC_ID"`
- `Appointment` records with `contactId`
- `Contact` records with `attributionUrl` (computed from GHL attributions array)
- Existing patterns: stacked bar charts with drill-down drawers, `shortPautaName()` for label truncation, `NonZeroTooltipContent` for tooltips

## Attribution Logic

The appointment → pauta link is URL-based:

1. Build `contactId → attributionUrl` map from `contacts` prop.
2. For each pauta, extract the URL from `nombrePauta` by splitting on `" - "` and taking index 1. Parse with `new URL()`.
3. Normalize both URLs: `hostname + pathname`, lowercase, strip trailing slash.
4. For each appointment: look up `contact.attributionUrl` → normalize → find pautas whose normalized URL matches → attribute appointment to those pautas.
5. An appointment may match zero pautas (unattributed, excluded from chart) or one pauta (typical case).

## Chart Spec

| Property | Value |
|---|---|
| Type | Vertical stacked bar chart |
| X-axis | Pauta name — `shortPautaName(nombrePauta)`, full name in tooltip |
| Y-axis | Appointment count (integer) |
| Stacks | One color per unique `appointment.status` (confirmed, showed, noshow, cancelled, new, etc.) |
| Sort | Top 20 pautas by total appointment count, descending |
| Title | "Citas por Pauta (atribución URL)" |
| Header total | Total attributed appointments |
| Icon | `Calendar` |
| Position | New full-width `DashboardCard` below the 4a/4b panel row |

## Interactions

- **Click a bar segment** → `openDrill()` with the opportunities whose contacts match that pauta + status combination. The drill drawer already shows appointments for those contacts.
- **Tooltip** → `NonZeroTooltipContent` showing status label and count, full pauta name as label.
- **Empty state** → `ChartEmpty` with message "Sin citas atribuidas por URL."
- **Hint** → "Apilado por estatus · atribución vía URL · haz clic para ver oportunidades"

## Data Derivation (useMemo)

```
apptsByPautaRows, apptsByPautaKeys = useMemo(() => {
  // 1. contactId → normalized attributionUrl
  // 2. pauta.nombrePauta → extract + normalize embedded URL
  // 3. Build normalized URL → pauta name map (one normalized URL can map to one pauta)
  // 4. For each appointment:
  //      normUrl = normalize(contactUrlMap.get(appt.contactId))
  //      pautaName = urlToPauta.get(normUrl)
  //      if pautaName: increment counts[pautaName][appt.status]
  // 5. Sort by total, slice top 20
  // 6. Build rows: [{ pauta, [status]: count }]
  // 7. Return rows + unique status keys (sorted by total volume)
})
```

## Helper Functions

**`normalizeUrl(raw: string): string`** — parse with `new URL()`, return `hostname + pathname.replace(/\/$/, "").toLowerCase()`. Return `""` on parse failure.

**`extractPautaUrl(nombrePauta: string): string`** — split by `" - "`, take index 1, run through `normalizeUrl`. Return `""` if not a valid URL.

Both helpers are pure functions defined at module level in `marketing-dashboard.tsx`.

## Status Color Palette

Use `CHART_PALETTE` (already imported) indexed by status order. No hardcoded status-to-color mapping needed — statuses are derived dynamically from data.

## Files Changed

- `components/dashboard/marketing-dashboard.tsx` — add helpers, add `useMemo`, add chart JSX below 4a/4b grid
