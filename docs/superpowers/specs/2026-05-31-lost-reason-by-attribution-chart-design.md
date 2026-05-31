# Oportunidades Perdidas por Razón de Pérdida — Design Spec

**Date:** 2026-05-31  
**Status:** Approved

---

## Overview

Add a stacked bar chart to the Marketing Dashboard showing lost opportunities broken down by lost reason (X axis) and attribution source (URL or Ad ID, stacked). This is the mirror view of "Oportunidades por Etapa del Pipeline", restricted to `status === "lost"`.

---

## Chart Spec

**Title:** "Oportunidades Perdidas por Razón de Pérdida"  
**Placement:** Full-width `DashboardCard`, immediately after "Oportunidades por Etapa del Pipeline (Sin oportunidades perdidas)"  
**Total badge:** Count of lost opps that have attribution data (URL or adId)

### Axes

| Axis | Value |
|------|-------|
| X | `o.lostReason \|\| "Sin razón"` |
| Y | Count of opportunities |

### Stack dimension

Each stack segment = one attribution key (URL or Ad ID), toggled via `GroupByToggle` (new `lostGroupBy` state, same `PaidGroupBy` type).  
Top 30 keys by total volume. Colors from `CHART_PALETTE`.

### Data computation (`useMemo`)

Name the derived values `lostByReasonRows` and `lostByReasonKeys`.

Algorithm (mirrors `pautaByStageRows`/`pautaByStageKeys`):

1. Collect all unique `lostReason` values from `opportunities.filter(o => o.status === "lost")`.
2. For each opportunity where `o.status === "lost"`:
   - Skip if `rawKey` (attribution URL or adId per toggle) is falsy.
   - Increment `perReason[lostReason][rawKey]`.
   - Increment `totals[rawKey]`.
3. Rank `rawKey`s by total descending, take top 30 → `lostByReasonKeys`.
4. Build rows: one row per `lostReason`, columns = top-30 keys.
5. Drop rows where all key counts are 0.

### Interactivity

- **Click on bar segment** → `openDrill(label, items)` where items = opps matching that reason + attribution key.
- **Tooltip** → `NonZeroTooltipContent` (required rule).
- **URL/ID toggle** → `GroupByToggle` in card header actions, controls `lostGroupBy` state.
- **Legend** → same style as pipeline stages chart (fontSize 10, paddingTop 48).

### Empty state

`<ChartEmpty message="Sin oportunidades perdidas con datos de atribución." height={300} />`

---

## State changes

Add one new state variable to `MarketingDashboard`:

```ts
const [lostGroupBy, setLostGroupBy] = useState<PaidGroupBy>("url")
```

---

## No new components

All required components already exist:
- `GroupByToggle`, `DashboardCard`, `ChartCardHeader`, `ChartCardContent`, `ChartEmpty`, `ChartHint`
- `NonZeroTooltipContent`, `CHART_PALETTE`, `CHART_GRID_STROKE`, `CHART_TICK`, `paidTrafficUrlLabel`
- `ChartDrillDrawer` (already rendered once at the bottom — shared)
