# Spec: Leads por Tipo de Anuncio — Mini Donut + Bar Breakdown

**Date:** 2026-05-21  
**File:** `components/dashboard/marketing-dashboard.tsx`  
**Scope:** Replace the current standalone donut pie chart with a side-by-side layout combining a compact donut and a ranked bar breakdown list.

---

## Goal

The current chart has a white-background tooltip, cluttered external labels, and a redundant bottom legend. Replace it with a layout that is denser, more readable on a dark theme, and keeps the full drill-down interaction.

---

## Layout

Flex row inside `<CardContent>`:

```
┌─────────────────────────────────────────────┐
│  [  Donut  ]   Paid Social    168 · 55%     │
│  [ 304 in  ]   ████████████████████         │
│  [ center  ]   CRM UI          42 · 14%     │
│              ████████                       │
│              Social media      40 · 13%     │
│              ██████████                     │
│              ...                            │
└─────────────────────────────────────────────┘
```

### Left panel — Donut (≈40% width)

- Recharts `<PieChart>` inside a `<ChartContainer>` sized `h-[200px] w-[160px]`
- `<Pie>` props: `innerRadius={50}`, `outerRadius={72}`, `cx="50%"`, `cy="50%"`
- No `label` prop, no `activeShape`, no `<Tooltip>`, no `<Legend>`
- `activeIndex` controlled by `hoveredAdType` state (see Interaction)
- Active segment uses a simple `activeShape` that increases `outerRadius` to `78` (subtle expand, no glow needed)
- SVG center text: total count in `font-size=20 font-weight=700 fill=white`, "LEADS" label below in `font-size=9 fill=#6b7280`
- Segment colors come from `leadsByAdType[].color` (unchanged)

### Right panel — Ranked list (≈60% width)

- Plain `<div>` flex-col, `gap-y-2.5`, `overflow-y-auto` (max ~6 items visible before scroll, though data is capped at however many adTypes exist)
- Each row:
  - Top line: `<span>` name (truncated at 18 chars with `…`), `<span>` `count · XX%` right-aligned in `text-muted-foreground`
  - Bottom: `6px` tall progress bar — outer track `bg-[#1f2937] rounded`, inner fill `bg-[entry.color]`, width = `(entry.value / leadsByAdType[0].value) * 100%` (relative to max, not total)
  - Row is `cursor-pointer hover:bg-accent/20 rounded px-1 py-0.5 -mx-1`
  - `onClick` → `openDrill(\`Tipo de Anuncio: \${adType}\`, opportunities.filter(...))`
  - `onMouseEnter` → sets `hoveredAdType` to this entry's index in `leadsByAdType`
  - `onMouseLeave` → clears `hoveredAdType`

---

## State Changes

| Before | After |
|--------|-------|
| `activePieIndex: number \| undefined` | `hoveredAdType: number \| undefined` |
| set on `<Pie> onMouseEnter/Leave` | set on bar row `onMouseEnter/Leave` |

`renderActiveShape` function is removed. Replace with an inline `activeShape` prop on `<Pie>` that just renders a slightly larger `outerRadius` when active:

```tsx
activeShape={(props: any) => (
  <Sector {...props} outerRadius={props.outerRadius + 5} />
)}
```

(`Sector` imported from `recharts`)

---

## What's Removed

- `renderActiveShape` function (top-level)
- `<Tooltip>` inside the PieChart
- `<Legend>` inside the PieChart
- `label` prop on `<Pie>`
- `activePieIndex` state and its setter
- `onMouseEnter` / `onMouseLeave` directly on `<Pie>`

---

## Container

- Outer `<div>` replacing the current `<div className="h-[260px]">`: `flex items-center gap-4`
- No fixed height on the outer div — height is driven by the list content (~260px naturally)
- The `<ChartContainer>` wrapping the donut is `h-[200px]` with an explicit pixel width of `160px`

---

## Data

`leadsByAdType` is already sorted descending by value (`sort((a,b) => b[1]-a[1])`) and has `.color` per entry. No data changes needed.

Percentage calculation per row: `((entry.value / total) * 100).toFixed(0)` where `total = leadsByAdType.reduce((s, e) => s + e.value, 0)`.

Progress bar width: `(entry.value / leadsByAdType[0].value) * 100` — relative to the largest segment so the top bar is always 100% wide.

---

## Drill-down

Unchanged behavior: clicking a bar row calls `openDrill(title, filteredOpportunities)` exactly as the current `<Pie onClick>` does. The helper text "Haz clic en un sector para ver los leads" stays below the card (update copy to "Haz clic en una fila para ver los leads").
