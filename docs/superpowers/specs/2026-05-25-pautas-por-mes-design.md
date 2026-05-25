# Pautas creadas por Mes — Design Spec

**Date:** 2026-05-25  
**Feature:** Chart showing pautas created over time, distributed by month-year on the X axis, stacked by tipo.

---

## Scope

Add a single new chart card to `components/dashboard/marketing-dashboard.tsx`. No new files, no API changes, no type changes.

---

## Data Transform

New `useMemo` — `pautasByMonth`:

1. For each pauta, call the existing `toUTCDateStr(p.createdAt)` and extract the `"YYYY-MM"` prefix as the bucket key.
2. Build a `Map<monthKey, Map<tipo, count>>`.
3. Collect all unique `tipo` values; rank by total volume descending — same pattern as `pautaByStageKeys`.
4. Sort months chronologically (ascending string sort on `"YYYY-MM"` keys).
5. Build rows: `{ monthLabel: "May 25", monthKey: "2025-05", [tipo]: count, ... }`.
6. X-axis label: abbreviated month + 2-digit year (Spanish locale, e.g., `"ene 25"` via `new Date(key + "-15").toLocaleDateString("es-MX", { month: "short", year: "2-digit" })`).

Returns `{ pautasByMonthRows, pautasByMonthKeys }` — same shape as `pautaByStageRows`/`pautaByStageKeys`.

---

## Chart

**Card title:** "Pautas creadas por Mes"  
**Icon:** `Calendar` from lucide-react (already imported or add it)  
**TotalBadge:** `pautas.length`

**Placement:** New full-width `Card` inserted between Row 1 (donut + pautas por tipo) and the existing "Oportunidades creadas por tiempo" card.

**Chart config:**
- `ChartContainer` + `ResponsiveContainer` + `BarChart` (vertical)
- Height: 280px
- `barCategoryGap="20%"`, `margin={{ top: 5, right: 16, left: 8, bottom: 60 }}`
- X axis: `dataKey="monthLabel"`, `angle={-45}`, `textAnchor="end"`, `fontSize: 10`, `interval={0}`
- Y axis: integer ticks, `allowDecimals={false}`
- One `<Bar stackId="a">` per tipo key, colors from `BAR_PALETTE`, `maxBarSize={40}`
- Top bar (last key) gets `radius={[4, 4, 0, 0]}`, rest get `[0, 0, 0, 0]`
- `<ChartTooltip content={<NonZeroTooltipContent />}>`
- `<Legend>` with `wrapperStyle={{ fontSize: 11, paddingTop: 8 }}`

**Click handler:** `openPautaDrill(\`${tipo} · ${monthLabel}\`, pautas.filter(p => monthKey match && tipo match))`

**Empty state:** `"Sin datos de Pautas."` at height 280px (same as other empty states).

**Hint text:** `"Haz clic en un segmento para ver las pautas"` (same pattern).

---

## Constraints

- No new imports beyond `Calendar` from lucide-react (if not already imported).
- Reuse `BAR_PALETTE`, `toUTCDateStr`, `NonZeroTooltipContent`, `openPautaDrill`, `TotalBadge` — all already defined in the file.
- No changes to API, types, or other components.
