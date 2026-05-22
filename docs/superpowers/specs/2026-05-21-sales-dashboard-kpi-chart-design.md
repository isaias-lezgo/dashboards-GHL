# Sales Dashboard KPI Cards + Stacked Bar Chart

**Date:** 2026-05-21  
**Status:** Approved

---

## Overview

Add a KPI strip and an opportunities-by-member chart to the currently empty `SalesDashboard` component. No new props, no new API calls — all metrics derive from the `opportunities` array already passed in.

---

## KPI Cards

Four cards in a 4-column responsive grid (`grid-cols-2 md:grid-cols-4`).

| # | Label | Computation | Icon |
|---|---|---|---|
| 1 | Total Oportunidades | `opportunities.length` | Target |
| 2 | Miembros Activos | `new Set(opportunities.map(o => o.assignedTo).filter(Boolean)).size` | Users |
| 3 | Tasa de Conversión | `won / total * 100`, formatted as `"X.X%"` | TrendingUp |
| 4 | Ingreso Ganado | `sum of o.value where o.status === "won"`, formatted as currency | DollarSign |

- Use shadcn `<Card>/<CardContent>` for each.
- Large bold number, small label above, icon top-right.
- Currency formatted with `toLocaleString("es-MX", { style: "currency", currency: "MXN" })` or plain `$` — use `es-MX` locale to match existing app language.

---

## Stacked Bar Chart — Oportunidades por Miembro por Etapa

### Data computation

```ts
// Derived inside useMemo from props.opportunities
const stages = [...new Set(opportunities.map(o => o.stage))]
const members = [...new Set(opportunities.map(o => o.assignedTo).filter(Boolean))]

const chartData = members.map(member => {
  const row: Record<string, string | number> = { member }
  for (const stage of stages) {
    row[stage] = opportunities.filter(o => o.assignedTo === member && o.stage === stage).length
  }
  return row
})
```

### Rendering

- `<BarChart layout="vertical">` inside shadcn `<ChartContainer>`
- `<YAxis dataKey="member" type="category">`
- `<XAxis type="number">`
- One `<Bar dataKey={stage} stackId="a">` per stage, colored via existing `STAGE_COLORS`
- `<Legend>` below the chart
- `<TotalBadge value={opportunities.length}>` top-right of the card header (reuse existing component)

### Stage colors

Reuse the existing `STAGE_COLORS` constant already in `sales-dashboard.tsx`. Any stage not in the map gets a neutral gray fallback (`#94a3b8`).

---

## Component structure

All logic stays in `components/dashboard/sales-dashboard.tsx`. No new files.

```
SalesDashboard
├── useMemo: kpiMetrics (totalOpps, activeMembers, conversionRate, wonRevenue)
├── useMemo: chartData (member × stage counts)
├── useMemo: allStages (unique stages from opportunities)
├── KPI grid (4 cards)
└── Chart card (stacked horizontal bar)
```

---

## Constraints

- No new props on `SalesDashboard` — `opportunities` already carries everything needed.
- Labels are in Spanish to match the rest of the app UI.
- Chart handles empty `opportunities` gracefully (renders empty state message instead of an empty chart).
- `assignedTo` may be `undefined` on some opportunities — filter those out before computing members.
