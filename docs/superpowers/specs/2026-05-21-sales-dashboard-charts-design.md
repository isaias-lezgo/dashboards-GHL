# Sales Dashboard — Charts Design

**Date:** 2026-05-21  
**Status:** Approved  
**Audience:** Sales manager monitoring real estate salespeople

---

## Overview

Add five charts to `SalesDashboard` organized into three labeled sections below the existing KPI cards and stacked bar chart. All charts derive exclusively from the `opportunities` prop — no calls or messages data. Labels are in Spanish to match the rest of the app.

---

## Layout

```
[ KPI Cards — 4 columns ]                               (existing)
[ Opps por Miembro por Etapa — stacked bar ]            (existing)

── Rendimiento Individual ───────────────────────────────────────
[ Chart A: Win/Loss por Asesor ]  [ Chart B: Ingreso Ganado por Asesor ]

── Salud del Pipeline ───────────────────────────────────────────
[ Chart C: Valor en Pipeline por Etapa ]  [ Chart D: Nuevas Opps por Período ]

── Análisis de Pérdidas ─────────────────────────────────────────
[ Chart E: Razones de Pérdida por Asesor — full width ]
```

Section headings are rendered as a muted label with a horizontal rule (`<Separator>`). Each pair of charts uses a `grid grid-cols-1 md:grid-cols-2 gap-4` layout. Chart E is full-width.

---

## Section 1 — Rendimiento Individual

### Chart A: Win/Loss por Asesor

- **Type:** Horizontal stacked bar (`<BarChart layout="vertical">`)
- **Data computation:**
  ```ts
  const members = [...new Set(opportunities.map(o => o.assignedTo).filter(Boolean))]
  const data = members.map(member => {
    const opps = opportunities.filter(o => o.assignedTo === member)
    return {
      member,
      won: opps.filter(o => o.status === "won").length,
      open: opps.filter(o => o.status === "open").length,
      lost: opps.filter(o => o.status === "lost").length,
      abandoned: opps.filter(o => o.status === "abandoned").length,
      winRate: opps.length > 0 ? (opps.filter(o => o.status === "won").length / opps.length * 100) : 0,
    }
  })
  ```
- **Colors:** won → `#10b981`, open → `#3b82f6`, lost → `#ef4444`, abandoned → `#94a3b8`
- **Win rate annotation:** Rendered as a custom label to the right of each stacked bar: `"X.X%"`
- **Axes:** YAxis = member name, XAxis = count
- **Empty state:** "Sin oportunidades para mostrar"

### Chart B: Ingreso Ganado por Asesor

- **Type:** Horizontal bar (`<BarChart layout="vertical">`)
- **Data computation:**
  ```ts
  const data = members
    .map(member => ({
      member,
      revenue: opportunities
        .filter(o => o.assignedTo === member && o.status === "won")
        .reduce((sum, o) => sum + o.value, 0),
    }))
    .sort((a, b) => b.revenue - a.revenue)
  ```
- **Color:** Single bar per rep, `#10b981`
- **Value format:** MXN currency via `toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })`
- **Tooltip:** Shows formatted currency value
- **Empty state:** "Sin ingresos ganados"

---

## Section 2 — Salud del Pipeline

### Chart C: Valor en Pipeline por Etapa

- **Type:** Horizontal bar (`<BarChart layout="vertical">`)
- **Data computation:**
  ```ts
  const stageOrder = ["Discovery", "Proposal", "Negotiation"] // natural pipeline order
  const allOpenStages = [...new Set(
    opportunities.filter(o => o.status === "open").map(o => o.stage)
  )]
  // Sort by stageOrder first, then alphabetically for unknown stages
  const data = allOpenStages
    .sort((a, b) => {
      const ai = stageOrder.indexOf(a)
      const bi = stageOrder.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    .map(stage => ({
      stage,
      value: opportunities
        .filter(o => o.stage === stage && o.status === "open")
        .reduce((sum, o) => sum + o.value, 0),
    }))
  ```
- **Note:** Stage order is derived from what's present in live data; the `stageOrder` array is a hint for sorting, not an exhaustive list.
- **Color:** Single bar, `#3b82f6`
- **Value format:** MXN currency in tooltip; YAxis shows stage name
- **Empty state:** "Sin oportunidades abiertas"

### Chart D: Nuevas Oportunidades por Período

- **Type:** Vertical bar chart (`<BarChart>`)
- **Grouping logic:**
  ```ts
  // Group by month if span > 60 days, by week otherwise
  const dates = opportunities.map(o => new Date(o.createdAt))
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))
  const spanDays = (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)
  const useMonths = spanDays > 60
  ```
- **Data computation:** Group `opportunities` by ISO week (`YYYY-Www`) or month (`YYYY-MM`), count per period
- **X-axis:** Period label (e.g., "Ene 2026", "Sem 5")
- **Y-axis:** Count of new opportunities
- **Color:** `#8b5cf6`
- **Empty state:** "Sin datos de tendencia"

---

## Section 3 — Análisis de Pérdidas

### Chart E: Razones de Pérdida por Asesor

- **Type:** Horizontal stacked bar (`<BarChart layout="vertical">`)
- **Scope:** Only opportunities where `status === "lost"`
- **Data computation:**
  ```ts
  const lostOpps = opportunities.filter(o => o.status === "lost")
  const members = [...new Set(lostOpps.map(o => o.assignedTo).filter(Boolean))]
  const reasons = [...new Set(lostOpps.map(o => o.lostReason ?? "Sin razón"))]
  const data = members.map(member => {
    const row: Record<string, string | number> = { member }
    for (const reason of reasons) {
      row[reason] = lostOpps.filter(
        o => o.assignedTo === member && (o.lostReason ?? "Sin razón") === reason
      ).length
    }
    return row
  })
  ```
- **Colors:** Assigned from `COLOR_PALETTE` (reuse existing constant in `sales-dashboard.tsx`)
- **Legend:** Shown below chart so reason labels are visible
- **Empty state:** "Sin oportunidades perdidas" (shown when no lost opportunities exist)
- **Full width:** This card spans the full dashboard width

---

## Component Structure

All logic stays in `components/dashboard/sales-dashboard.tsx`. No new files, no new props.

```
SalesDashboard
├── useMemo: kpiMetrics                    (existing)
├── useMemo: allStages                     (existing)
├── useMemo: chartData (opps by member)    (existing)
├── useMemo: chartConfig                   (existing)
│
├── useMemo: members                       (new — shared across charts A, B, E)
├── useMemo: winLossData                   (Chart A)
├── useMemo: revenueData                   (Chart B)
├── useMemo: pipelineValueData             (Chart C)
├── useMemo: trendData                     (Chart D)
├── useMemo: lostReasonsData               (Chart E)
│
├── KPI grid                               (existing)
├── Stacked bar: opps by member by stage   (existing)
│
├── Section: Rendimiento Individual
│   ├── Chart A: Win/Loss por Asesor
│   └── Chart B: Ingreso Ganado por Asesor
│
├── Section: Salud del Pipeline
│   ├── Chart C: Valor en Pipeline por Etapa
│   └── Chart D: Nuevas Oportunidades por Período
│
└── Section: Análisis de Pérdidas
    └── Chart E: Razones de Pérdida por Asesor (full width)
```

---

## Constraints

- No new props — `opportunities` already carries everything needed.
- `calls` and `messages` props remain on the component signature but are not used in any new chart.
- All labels in Spanish.
- Every chart has an empty-state fallback message.
- `assignedTo` may be `undefined` — always filter before computing per-rep data.
- `lostReason` may be `undefined` — treat as `"Sin razón"`.
- Currency formatted with `es-MX` locale and `MXN` currency code, matching existing KPI card style.
- Stage ordering for Chart C uses a known list as a sort hint; unknown stage names fall to the end alphabetically.
