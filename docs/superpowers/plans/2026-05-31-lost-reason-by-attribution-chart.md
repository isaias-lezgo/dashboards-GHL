# Oportunidades Perdidas por Razón de Pérdida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stacked bar chart to the Marketing Dashboard showing lost opportunities broken down by lost reason (X axis) and attribution URL or Ad ID (stacked bars), with a URL/ID toggle and drill-down drawer.

**Architecture:** All changes are confined to `components/dashboard/marketing-dashboard.tsx`. A new `lostGroupBy` state drives which attribution key (URL vs Ad ID) is used. A new `useMemo` computes rows/keys from `status === "lost"` opportunities, mirroring the existing `pautaByStageRows`/`pautaByStageKeys` logic. A new `DashboardCard` renders the chart, placed after "Oportunidades por Etapa del Pipeline".

**Tech Stack:** React (useMemo, useState), Recharts (BarChart, Bar, XAxis, YAxis, Legend, CartesianGrid, ResponsiveContainer), shadcn ChartContainer/ChartTooltip, Tailwind CSS, lucide-react.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `components/dashboard/marketing-dashboard.tsx` | New state, new useMemo, new chart JSX, one new icon import |

---

### Task 1: Add state, useMemo, and config for the new chart

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx`

- [ ] **Step 1: Add `TrendingDown` to the lucide-react import**

In the existing import at the top of the file, add `TrendingDown`:

```ts
import { Tag, FileText, Calendar, BarChart3, Layers, TrendingUp, TrendingDown, Facebook, Instagram, Copy, Check } from "lucide-react"
```

- [ ] **Step 2: Add `lostGroupBy` state inside `MarketingDashboard`**

After the existing `const [stageGroupBy, setStageGroupBy] = useState<PaidGroupBy>("url")` line (around line 265), add:

```ts
const [lostGroupBy, setLostGroupBy] = useState<PaidGroupBy>("url")
```

- [ ] **Step 3: Add `lostByReasonRows`/`lostByReasonKeys` useMemo**

After the `pautaByStageTotal` declaration (around line 498), add:

```ts
const { lostByReasonRows, lostByReasonKeys } = useMemo(() => {
  const totals = new Map<string, number>()
  const perReason = new Map<string, Map<string, number>>()

  for (const opp of opportunities) {
    if (opp.status !== "lost") continue
    const rawKey = lostGroupBy === "url" ? opp.attributionUrl : opp.adId
    if (!rawKey) continue
    const reason = opp.lostReason || "Sin razón"
    if (!perReason.has(reason)) perReason.set(reason, new Map())
    const reasonMap = perReason.get(reason)!
    reasonMap.set(rawKey, (reasonMap.get(rawKey) ?? 0) + 1)
    totals.set(rawKey, (totals.get(rawKey) ?? 0) + 1)
  }

  const keys = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k]) => k)

  const reasons = Array.from(perReason.keys()).sort()

  const rows = reasons
    .map((reason) => {
      const row: Record<string, string | number> = { reason }
      const reasonMap = perReason.get(reason)!
      for (const k of keys) row[k] = reasonMap.get(k) ?? 0
      return row
    })
    .filter((row) => keys.some((k) => (row[k] as number) > 0))

  return { lostByReasonRows: rows, lostByReasonKeys: keys }
}, [opportunities, lostGroupBy])

const lostByReasonConfig = Object.fromEntries(
  lostByReasonKeys.map((k, i) => [
    k,
    { label: lostGroupBy === "url" ? paidTrafficUrlLabel(k) : k, color: CHART_PALETTE[i % CHART_PALETTE.length] },
  ])
)

const lostByReasonTotal = lostByReasonRows.reduce(
  (s, r) => s + lostByReasonKeys.reduce((a, k) => a + ((r[k] as number) || 0), 0),
  0
)
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes (TypeScript errors are ignored by next.config.mjs, but check for obvious runtime-breaking issues in the output).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat: add lostByReason data computation for lost attribution chart"
```

---

### Task 2: Add the chart card JSX

**Files:**
- Modify: `components/dashboard/marketing-dashboard.tsx`

- [ ] **Step 1: Insert the new DashboardCard after "Oportunidades por Etapa del Pipeline"**

Find the closing `</DashboardCard>` of the "Oportunidades por Etapa del Pipeline" card (the one ending around line 1020 that contains `pautaByStageRows`). Insert this new card directly after it:

```tsx
<DashboardCard>
  <ChartCardHeader
    title="Oportunidades Perdidas por Razón de Pérdida"
    total={lostByReasonTotal}
    icon={TrendingDown}
    actions={<GroupByToggle value={lostGroupBy} onChange={setLostGroupBy} />}
  />
  <ChartCardContent>
    {lostByReasonKeys.length === 0 ? (
      <ChartEmpty message="Sin oportunidades perdidas con datos de atribución." height={300} />
    ) : (
      <>
        <ChartContainer config={lostByReasonConfig} className="aspect-auto" style={{ height: 480 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={lostByReasonRows} margin={{ top: 5, right: 16, left: 8, bottom: 16 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
              <XAxis
                dataKey="reason"
                tick={{ fontSize: 10, fill: CHART_TICK.fill }}
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-25}
                textAnchor="end"
                tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 22) + "…" : v}
              />
              <YAxis tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip content={<NonZeroTooltipContent />} />
              <Legend
                wrapperStyle={{ fontSize: 10, paddingTop: 48, lineHeight: "36px" }}
                iconSize={8}
                formatter={(value: string) => (
                  <span style={{ color: "#374151", marginRight: 4 }} title={value}>
                    {lostGroupBy === "url" ? paidTrafficUrlLabel(value) : value.slice(0, 20)}
                  </span>
                )}
              />
              {lostByReasonKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="a"
                  fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                  radius={i === lostByReasonKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  maxBarSize={56}
                  cursor="pointer"
                  onClick={(data: any) => {
                    const count = data[key] as number
                    if (!count) return
                    const reason = data.reason as string
                    const items = opportunities.filter((o) => {
                      if (o.status !== "lost") return false
                      if ((o.lostReason || "Sin razón") !== reason) return false
                      const rawKey = lostGroupBy === "url" ? o.attributionUrl : o.adId
                      return rawKey === key
                    })
                    const label = lostGroupBy === "url" ? paidTrafficUrlLabel(key) : key
                    openDrill(
                      `${label} · ${reason}`,
                      items,
                      `${items.length} oportunidad${items.length !== 1 ? "es" : ""} perdida${items.length !== 1 ? "s" : ""} — ${reason}`
                    )
                  }}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
        <ChartHint>
          {`Apilado por ${lostGroupBy === "url" ? "URL de atribución" : "ID de anuncio"} · top 30 · haz clic en un segmento para ver las oportunidades`}
        </ChartHint>
      </>
    )}
  </ChartCardContent>
</DashboardCard>
```

- [ ] **Step 2: Start dev server and verify**

```bash
npm run dev
```

Navigate to `http://localhost:3000`, go to the Marketing tab, scroll past "Oportunidades por Etapa del Pipeline". Verify:
- New chart card appears with title "Oportunidades Perdidas por Razón de Pérdida"
- Total badge shows count of lost opps with attribution data (or 0 if none)
- URL/ID toggle is visible in card header
- If data exists: bars render, legend appears, clicking a bar opens the drill drawer
- If no data: empty state message shows

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/marketing-dashboard.tsx
git commit -m "feat: add Oportunidades Perdidas por Razón de Pérdida chart

Stacked bar showing lost opps by lost reason, segmented by attribution URL
or Ad ID, with URL/ID toggle and drill-down drawer."
```
