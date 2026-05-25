# Pautas creadas por Mes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-width stacked bar chart to the marketing dashboard showing pautas created per month-year, stacked by tipo.

**Architecture:** Single `useMemo` computes monthly buckets from `pautas[]`; a new `Card` renders the stacked `BarChart` using the same helpers already in the file (`toUTCDateStr`, `BAR_PALETTE`, `NonZeroTooltipContent`, `openPautaDrill`, `TotalBadge`). No API or type changes needed.

**Tech Stack:** React (useMemo), Recharts (BarChart/Bar/XAxis/YAxis/Legend), shadcn ChartContainer, lucide-react

---

## File Map

| File | Change |
|------|--------|
| `components/dashboard/marketing-dashboard.tsx` | Add `Calendar` to lucide import · Add `pautasByMonth` useMemo · Add new Card JSX between Row 1 and Row 2 |

---

### Task 1: Add `Calendar` to the lucide-react import

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx:24`

- [ ] **Step 1: Update the import line**

Replace line 24:
```tsx
import { Megaphone, Globe, BarChart3, Layers, TrendingDown, Tag, FileText } from "lucide-react"
```
with:
```tsx
import { Megaphone, Globe, BarChart3, Layers, TrendingDown, Tag, FileText, Calendar } from "lucide-react"
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output (or only pre-existing errors unrelated to this file).

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat(marketing-dashboard): add Calendar icon import for pautas por mes chart"
```

---

### Task 2: Add the `pautasByMonth` data transform

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx` — insert new `useMemo` after the `pautaByStageConfig` / `pautaByStageTotal` lines (around line 382)

- [ ] **Step 1: Insert the useMemo after `pautaByStageTotal`**

Find this block (around line 379–383):
```tsx
  const pautaByStageTotal = pautaByStageRows.reduce(
    (s, r) => s + pautaByStageKeys.reduce((a, k) => a + ((r[k] as number) || 0), 0),
    0
  )
```

Insert immediately after:
```tsx
  // Pautas grouped by calendar month (YYYY-MM), stacked by tipo.
  const { pautasByMonthRows, pautasByMonthKeys } = useMemo(() => {
    if (pautas.length === 0) return { pautasByMonthRows: [], pautasByMonthKeys: [] }

    // Bucket each pauta into its "YYYY-MM" month key
    const byMonth = new Map<string, Map<string, number>>()
    const tipoTotals = new Map<string, number>()

    for (const p of pautas) {
      const dateStr = toUTCDateStr(p.createdAt)
      if (!dateStr) continue
      const monthKey = dateStr.slice(0, 7) // "YYYY-MM"
      const tipo = p.tipo || "Sin tipo"

      if (!byMonth.has(monthKey)) byMonth.set(monthKey, new Map())
      const tipoMap = byMonth.get(monthKey)!
      tipoMap.set(tipo, (tipoMap.get(tipo) ?? 0) + 1)
      tipoTotals.set(tipo, (tipoTotals.get(tipo) ?? 0) + 1)
    }

    // Tipos ranked by total volume descending
    const keys = Array.from(tipoTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)

    // Months sorted chronologically
    const sortedMonths = Array.from(byMonth.keys()).sort()

    const rows = sortedMonths.map((monthKey) => {
      // Label: "ene 25", "feb 25", etc. using es-MX locale
      const label = new Date(monthKey + "-15T12:00:00Z")
        .toLocaleDateString("es-MX", { month: "short", year: "2-digit" })
      const row: Record<string, string | number> = { monthKey, monthLabel: label }
      const tipoMap = byMonth.get(monthKey)!
      for (const k of keys) row[k] = tipoMap.get(k) ?? 0
      return row
    })

    return { pautasByMonthRows: rows, pautasByMonthKeys: keys }
  }, [pautas])
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat(marketing-dashboard): add pautasByMonth data transform"
```

---

### Task 3: Render the "Pautas creadas por Mes" chart card

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx` — insert new Card JSX between Row 1 (`</div>` closing the grid) and Row 2 (the `oppsByDayRows` card)

- [ ] **Step 1: Locate the insertion point**

Find this comment and opening tag (around line 591):
```tsx
      {/* Row 2: Oportunidades creadas por tiempo y fuente — full width */}
      <Card className="shadow-sm">
```

- [ ] **Step 2: Insert the new card immediately before that block**

```tsx
      {/* Pautas creadas por Mes — full width stacked bar */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Calendar className={iconCls} />
          <CardTitle className="text-sm font-semibold">Pautas creadas por Mes</CardTitle>
          <TotalBadge value={pautas.length} />
        </CardHeader>
        <CardContent>
          {pautasByMonthKeys.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              Sin datos de Pautas.
            </div>
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  pautasByMonthKeys.map((k, i) => [k, { label: k, color: BAR_PALETTE[i % BAR_PALETTE.length] }])
                )}
                className="aspect-auto"
                style={{ height: 280 }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={pautasByMonthRows}
                    margin={{ top: 5, right: 16, left: 8, bottom: 60 }}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis
                      dataKey="monthLabel"
                      tick={{ fontSize: 10, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-45}
                      textAnchor="end"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <ChartTooltip content={<NonZeroTooltipContent />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      formatter={(value) => <span style={{ color: "#374151" }}>{value}</span>}
                    />
                    {pautasByMonthKeys.map((key, i) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="a"
                        fill={BAR_PALETTE[i % BAR_PALETTE.length]}
                        radius={i === pautasByMonthKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        maxBarSize={40}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const count = data[key] as number
                          if (!count) return
                          const monthKey = data.monthKey as string
                          const monthLabel = data.monthLabel as string
                          const items = pautas.filter(
                            (p) =>
                              toUTCDateStr(p.createdAt).slice(0, 7) === monthKey &&
                              (p.tipo || "Sin tipo") === key
                          )
                          openPautaDrill(`${key} · ${monthLabel}`, items)
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <p className="mt-1 text-center text-[10px] text-muted-foreground">
                Apilado por tipo · haz clic en un segmento para ver las pautas
              </p>
            </>
          )}
        </CardContent>
      </Card>

```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 4: Start the dev server and visually verify**

```bash
npm run dev
```

Open http://localhost:3000, switch to the Marketing tab, and confirm:
- The "Pautas creadas por Mes" card appears between "Pautas por Tipo" and "Oportunidades creadas por tiempo"
- Bars are grouped by month-year on the X axis with rotated labels
- Legend shows the tipos with correct colors
- Clicking a bar segment opens the pauta drill-down drawer filtered to that month and tipo
- Empty state shows correctly if pautas array is empty (test with mock data if needed)

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat(marketing-dashboard): add Pautas creadas por Mes stacked bar chart"
```
