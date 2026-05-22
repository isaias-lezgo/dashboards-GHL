# Sales Dashboard Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five charts to `SalesDashboard` in three labeled sections — Rendimiento Individual, Salud del Pipeline, and Análisis de Pérdidas — all derived from the existing `opportunities` prop.

**Architecture:** All logic stays in `components/dashboard/sales-dashboard.tsx`. Six new `useMemo` hooks derive chart data from `opportunities`. A `SectionHeader` helper component renders labeled dividers. No new files, no new props.

**Tech Stack:** React 19, Next.js 15 App Router, Recharts (via shadcn `ChartContainer`/`ChartTooltipContent`), Tailwind CSS v3

---

## File Structure

Single file modified:

- **Modify:** `components/dashboard/sales-dashboard.tsx`
  - Add `LabelList` to Recharts import
  - Add `WIN_LOSS_CONFIG` and `PIPELINE_STAGE_ORDER` constants
  - Add `SectionHeader` helper component
  - Add `members` useMemo (shared by Charts A and B)
  - Add `winLossData` useMemo → Chart A
  - Add `revenueData` useMemo → Chart B
  - Add `pipelineValueData` useMemo → Chart C
  - Add `trendData` useMemo → Chart D
  - Add `lostReasonsData` + `lostReasonsConfig` useMemos → Chart E
  - Add three labeled sections to the JSX return

---

### Task 1: Add LabelList import, SectionHeader component, and members useMemo

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add `LabelList` to the Recharts import**

Replace the existing Recharts import block:
```tsx
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts"
```
With:
```tsx
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LabelList,
} from "recharts"
```

- [ ] **Step 2: Add `SectionHeader` component**

Add this function after the existing `TotalBadge` component (around line 63):
```tsx
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
        {title}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}
```

- [ ] **Step 3: Add `members` useMemo inside `SalesDashboard`**

Add this immediately after the existing `chartConfig` useMemo:
```tsx
const members = useMemo(
  () =>
    [
      ...new Set(
        opportunities
          .map((o) => o.assignedTo)
          .filter((m): m is string => Boolean(m))
      ),
    ],
  [opportunities]
)
```

- [ ] **Step 4: Start dev server and verify no errors**

Run: `npm run dev`

Open `http://localhost:3000`, click the **Ventas** tab. The dashboard should look identical to before. Check browser console — no errors expected.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add SectionHeader helper and members memo"
```

---

### Task 2: Chart A — Win/Loss por Asesor

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add `WIN_LOSS_CONFIG` constant**

Add this after the existing `COLOR_PALETTE` constant near the top of the file:
```tsx
const WIN_LOSS_CONFIG = {
  won:       { label: "Ganado",      color: "#10b981" },
  open:      { label: "Abierto",     color: "#3b82f6" },
  lost:      { label: "Perdido",     color: "#ef4444" },
  abandoned: { label: "Abandonado",  color: "#94a3b8" },
} as const
```

- [ ] **Step 2: Add `winLossData` useMemo**

Add this after the `members` useMemo:
```tsx
const winLossData = useMemo(
  () =>
    members.map((member) => {
      const opps = opportunities.filter((o) => o.assignedTo === member)
      const won = opps.filter((o) => o.status === "won").length
      return {
        member,
        won,
        open:      opps.filter((o) => o.status === "open").length,
        lost:      opps.filter((o) => o.status === "lost").length,
        abandoned: opps.filter((o) => o.status === "abandoned").length,
        winRate:   opps.length > 0 ? (won / opps.length) * 100 : 0,
      }
    }),
  [members, opportunities]
)
```

- [ ] **Step 3: Add Section 1 with Chart A to the JSX**

Inside the `return (...)` of `SalesDashboard`, add this block immediately after the closing `</Card>` of the existing stacked bar chart (before the root `</div>`):

```tsx
{/* ── Rendimiento Individual ─────────────────── */}
<SectionHeader title="Rendimiento Individual" />
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {/* Chart A: Win/Loss por Asesor */}
  <Card>
    <CardHeader className="flex flex-row items-center pb-2">
      <CardTitle className="text-base font-semibold">
        Win/Loss por Asesor
      </CardTitle>
      <TotalBadge value={opportunities.length} />
    </CardHeader>
    <CardContent>
      {winLossData.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          Sin oportunidades para mostrar
        </div>
      ) : (
        <ChartContainer
          config={WIN_LOSS_CONFIG}
          style={{ height: Math.max(200, winLossData.length * 64) }}
          className="w-full"
        >
          <BarChart
            data={winLossData}
            layout="vertical"
            margin={{ left: 8, right: 48, top: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <YAxis
              dataKey="member"
              type="category"
              width={68}
              tick={{ fontSize: 12 }}
            />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Legend />
            <Bar dataKey="won"      stackId="a" fill={WIN_LOSS_CONFIG.won.color} />
            <Bar dataKey="open"     stackId="a" fill={WIN_LOSS_CONFIG.open.color} />
            <Bar dataKey="lost"     stackId="a" fill={WIN_LOSS_CONFIG.lost.color} />
            <Bar dataKey="abandoned" stackId="a" fill={WIN_LOSS_CONFIG.abandoned.color}>
              <LabelList
                dataKey="winRate"
                position="right"
                formatter={(v: unknown) =>
                  typeof v === "number" ? `${v.toFixed(1)}%` : ""
                }
                style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </CardContent>
  </Card>

  {/* Chart B placeholder — filled in Task 3 */}
  <div />
</div>
```

- [ ] **Step 4: Verify Chart A in the browser**

Open `http://localhost:3000`, click **Ventas**. You should see:
- "Rendimiento Individual" section label with a horizontal rule below the existing charts
- A stacked horizontal bar per rep showing won / open / lost / abandoned counts
- Win rate percentages to the right of each bar (e.g., "6.3%")
- A legend with four colors

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Chart A win/loss breakdown per rep"
```

---

### Task 3: Chart B — Ingreso Ganado por Asesor

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add `revenueData` useMemo**

Add this after the `winLossData` useMemo:
```tsx
const revenueData = useMemo(
  () =>
    members
      .map((member) => ({
        member,
        revenue: opportunities
          .filter((o) => o.assignedTo === member && o.status === "won")
          .reduce((sum, o) => sum + o.value, 0),
      }))
      .sort((a, b) => b.revenue - a.revenue),
  [members, opportunities]
)
```

- [ ] **Step 2: Replace the Chart B placeholder with Chart B**

Find `{/* Chart B placeholder — filled in Task 3 */}` and the `<div />` immediately after it. Replace just the `<div />` with:

```tsx
{/* Chart B: Ingreso Ganado por Asesor */}
<Card>
  <CardHeader className="flex flex-row items-center pb-2">
    <CardTitle className="text-base font-semibold">
      Ingreso Ganado por Asesor
    </CardTitle>
  </CardHeader>
  <CardContent>
    {revenueData.every((d) => d.revenue === 0) ? (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Sin ingresos ganados
      </div>
    ) : (
      <ChartContainer
        config={{ revenue: { label: "Ingreso Ganado", color: "#10b981" } }}
        style={{ height: Math.max(200, revenueData.length * 64) }}
        className="w-full"
      >
        <BarChart
          data={revenueData}
          layout="vertical"
          margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <YAxis
            dataKey="member"
            type="category"
            width={68}
            tick={{ fontSize: 12 }}
          />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) =>
                  typeof value === "number"
                    ? value.toLocaleString("es-MX", {
                        style: "currency",
                        currency: "MXN",
                        maximumFractionDigits: 0,
                      })
                    : String(value)
                }
              />
            }
          />
          <Bar dataKey="revenue" fill="#10b981" />
        </BarChart>
      </ChartContainer>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 3: Verify Chart B in the browser**

Open `http://localhost:3000`, click **Ventas**. You should see:
- Charts A and B side by side in "Rendimiento Individual"
- Chart B shows one bar per rep sorted descending by revenue
- Tooltip shows MXN currency (e.g., "$35,000")

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Chart B won revenue per rep"
```

---

### Task 4: Chart C — Valor en Pipeline por Etapa

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add `PIPELINE_STAGE_ORDER` constant**

Add this after the `WIN_LOSS_CONFIG` constant:
```tsx
const PIPELINE_STAGE_ORDER = ["Discovery", "Proposal", "Negotiation"]
```

- [ ] **Step 2: Add `pipelineValueData` useMemo**

Add this after the `revenueData` useMemo:
```tsx
const pipelineValueData = useMemo(() => {
  const openOpps = opportunities.filter((o) => o.status === "open")
  const stages = [...new Set(openOpps.map((o) => o.stage))]
  return stages
    .sort((a, b) => {
      const ai = PIPELINE_STAGE_ORDER.indexOf(a)
      const bi = PIPELINE_STAGE_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    .map((stage) => ({
      stage,
      value: openOpps
        .filter((o) => o.stage === stage)
        .reduce((sum, o) => sum + o.value, 0),
    }))
}, [opportunities])
```

- [ ] **Step 3: Add Section 2 with Chart C to the JSX**

After the closing `</div>` of the Section 1 grid, add:

```tsx
{/* ── Salud del Pipeline ─────────────────────── */}
<SectionHeader title="Salud del Pipeline" />
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {/* Chart C: Valor en Pipeline por Etapa */}
  <Card>
    <CardHeader className="flex flex-row items-center pb-2">
      <CardTitle className="text-base font-semibold">
        Valor en Pipeline por Etapa
      </CardTitle>
    </CardHeader>
    <CardContent>
      {pipelineValueData.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          Sin oportunidades abiertas
        </div>
      ) : (
        <ChartContainer
          config={{ value: { label: "Valor en Pipeline", color: "#3b82f6" } }}
          style={{ height: Math.max(200, pipelineValueData.length * 64) }}
          className="w-full"
        >
          <BarChart
            data={pipelineValueData}
            layout="vertical"
            margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <YAxis
              dataKey="stage"
              type="category"
              width={90}
              tick={{ fontSize: 12 }}
            />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    typeof value === "number"
                      ? value.toLocaleString("es-MX", {
                          style: "currency",
                          currency: "MXN",
                          maximumFractionDigits: 0,
                        })
                      : String(value)
                  }
                />
              }
            />
            <Bar dataKey="value" fill="#3b82f6" />
          </BarChart>
        </ChartContainer>
      )}
    </CardContent>
  </Card>

  {/* Chart D placeholder — filled in Task 5 */}
  <div />
</div>
```

- [ ] **Step 4: Verify Chart C in the browser**

Open `http://localhost:3000`, click **Ventas**. You should see:
- "Salud del Pipeline" section label
- Chart C with one bar per open stage (Discovery, Proposal, Negotiation…) ordered by pipeline progression
- Tooltip shows total MXN value sitting in that stage

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Chart C pipeline value by stage"
```

---

### Task 5: Chart D — Nuevas Oportunidades por Período

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add `trendData` useMemo**

Add this after the `pipelineValueData` useMemo:
```tsx
const trendData = useMemo(() => {
  if (opportunities.length === 0) return []
  const timestamps = opportunities
    .map((o) => new Date(o.createdAt).getTime())
    .filter((t) => !Number.isNaN(t))
  if (timestamps.length === 0) return []
  const spanDays =
    (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24)
  const useMonths = spanDays > 60

  const buckets = new Map<string, number>()
  for (const opp of opportunities) {
    const d = new Date(opp.createdAt)
    if (Number.isNaN(d.getTime())) continue
    let key: string
    if (useMonths) {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    } else {
      const day = d.getDay() || 7
      const monday = new Date(d)
      monday.setDate(d.getDate() - day + 1)
      key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`
    }
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({
      period: useMonths
        ? new Date(key + "-01").toLocaleDateString("es-MX", {
            month: "short",
            year: "numeric",
          })
        : `Sem ${key}`,
      count,
    }))
}, [opportunities])
```

- [ ] **Step 2: Replace the Chart D placeholder with Chart D**

Find `{/* Chart D placeholder — filled in Task 5 */}` and the `<div />` after it. Replace the `<div />` with:

```tsx
{/* Chart D: Nuevas Oportunidades por Período */}
<Card>
  <CardHeader className="flex flex-row items-center pb-2">
    <CardTitle className="text-base font-semibold">
      Nuevas Oportunidades por Período
    </CardTitle>
    <TotalBadge value={opportunities.length} />
  </CardHeader>
  <CardContent>
    {trendData.length === 0 ? (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Sin datos de tendencia
      </div>
    ) : (
      <ChartContainer
        config={{ count: { label: "Nuevas Oportunidades", color: "#8b5cf6" } }}
        style={{ height: 220 }}
        className="w-full"
      >
        <BarChart
          data={trendData}
          margin={{ left: 8, right: 8, top: 8, bottom: 32 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11 }}
            angle={-35}
            textAnchor="end"
            interval={0}
          />
          <YAxis tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 3: Verify Chart D in the browser**

Open `http://localhost:3000`, click **Ventas**. You should see:
- Charts C and D side by side in "Salud del Pipeline"
- Chart D shows vertical bars per period with angled X-axis labels
- With mock data (all dates Jan–Feb 2026, span < 60 days), expect weekly buckets like "Sem 2026-01-26", etc.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Chart D new opportunities trend over time"
```

---

### Task 6: Chart E — Razones de Pérdida por Asesor

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add `lostReasonsData` and `lostReasonsConfig` useMemos**

Add these after the `trendData` useMemo:
```tsx
const lostReasonsData = useMemo(() => {
  const lostOpps = opportunities.filter((o) => o.status === "lost")
  const lostMembers = [
    ...new Set(
      lostOpps
        .map((o) => o.assignedTo)
        .filter((m): m is string => Boolean(m))
    ),
  ]
  const reasons = [
    ...new Set(lostOpps.map((o) => o.lostReason ?? "Sin razón")),
  ]
  return {
    data: lostMembers.map((member) => {
      const row: Record<string, string | number> = { member }
      for (const reason of reasons) {
        row[reason] = lostOpps.filter(
          (o) =>
            o.assignedTo === member &&
            (o.lostReason ?? "Sin razón") === reason
        ).length
      }
      return row
    }),
    reasons,
  }
}, [opportunities])

const lostReasonsConfig = useMemo(
  () =>
    Object.fromEntries(
      lostReasonsData.reasons.map((reason, i) => [
        reason,
        { label: reason, color: COLOR_PALETTE[i % COLOR_PALETTE.length] },
      ])
    ),
  [lostReasonsData.reasons]
)
```

- [ ] **Step 2: Add Section 3 with Chart E to the JSX**

After the closing `</div>` of the Section 2 grid, add:

```tsx
{/* ── Análisis de Pérdidas ───────────────────── */}
<SectionHeader title="Análisis de Pérdidas" />
<Card>
  <CardHeader className="flex flex-row items-center pb-2">
    <CardTitle className="text-base font-semibold">
      Razones de Pérdida por Asesor
    </CardTitle>
    <TotalBadge
      value={opportunities.filter((o) => o.status === "lost").length}
    />
  </CardHeader>
  <CardContent>
    {lostReasonsData.data.length === 0 ? (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Sin oportunidades perdidas
      </div>
    ) : (
      <ChartContainer
        config={lostReasonsConfig}
        style={{ height: Math.max(200, lostReasonsData.data.length * 64) }}
        className="w-full"
      >
        <BarChart
          data={lostReasonsData.data}
          layout="vertical"
          margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <YAxis
            dataKey="member"
            type="category"
            width={68}
            tick={{ fontSize: 12 }}
          />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Legend />
          {lostReasonsData.reasons.map((reason, i) => (
            <Bar
              key={reason}
              dataKey={reason}
              stackId="a"
              fill={COLOR_PALETTE[i % COLOR_PALETTE.length]}
            />
          ))}
        </BarChart>
      </ChartContainer>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 3: Final visual verification — full dashboard scan**

Open `http://localhost:3000`, click **Ventas**. Scroll through and confirm each of these:

1. KPI cards (4) — unchanged ✓
2. "Leads por Miembro por Etapa del Pipeline" stacked bar — unchanged ✓
3. "Rendimiento Individual" header visible ✓
4. Chart A (Win/Loss por Asesor) — stacked bar with % annotations on right ✓
5. Chart B (Ingreso Ganado por Asesor) — single bars sorted descending, MXN tooltip ✓
6. "Salud del Pipeline" header visible ✓
7. Chart C (Valor en Pipeline por Etapa) — bars for each open stage, MXN tooltip ✓
8. Chart D (Nuevas Oportunidades por Período) — vertical bars with angled date labels ✓
9. "Análisis de Pérdidas" header visible ✓
10. Chart E (Razones de Pérdida por Asesor) — full-width stacked bar by lost reason ✓
11. Changing the Member filter in the filter bar updates all charts ✓
12. No console errors ✓

- [ ] **Step 4: Final commit**

```bash
git add components/dashboard/sales-dashboard.tsx
git commit -m "feat(sales): add Chart E lost reasons by rep — complete sales dashboard"
```
