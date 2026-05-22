# Sales Dashboard KPI Cards + Stacked Bar Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty `SalesDashboard` component with four KPI cards and a stacked horizontal bar chart showing opportunities per member per pipeline stage.

**Architecture:** All logic lives in `components/dashboard/sales-dashboard.tsx`. Three `useMemo` hooks derive `kpiMetrics`, `allStages`, and `chartData` from the `opportunities` prop. No new files, no new props, no API changes.

**Tech Stack:** Next.js 15 (App Router), React, Recharts via shadcn `ChartContainer`, shadcn `Card`, Tailwind CSS, lucide-react icons.

---

## File Map

| Action | Path |
|---|---|
| Modify | `components/dashboard/sales-dashboard.tsx` |

---

### Task 1: Add KPI metrics and four KPI cards

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

Note: This project has no automated tests. Verify visually via `npm run dev`.

- [ ] **Step 1: Replace the file with KPI cards implementation**

Replace the entire contents of `components/dashboard/sales-dashboard.tsx` with:

```tsx
"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { Opportunity, Call, Message } from "@/lib/types"
import {
  Users,
  TrendingUp,
  Target,
  DollarSign,
} from "lucide-react"

interface SalesDashboardProps {
  opportunities: Opportunity[]
  calls: Call[]
  messages: Message[]
}

const STAGE_COLORS: Record<string, string> = {
  Discovery: "#3b82f6",
  Proposal: "#8b5cf6",
  Negotiation: "#f59e0b",
  "Closed Won": "#10b981",
  "Closed Lost": "#ef4444",
}

function TotalBadge({ value }: { value: number | string }) {
  return (
    <span className="ml-auto inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
      Total: {typeof value === "number" ? value.toLocaleString() : value}
    </span>
  )
}

export function SalesDashboard({ opportunities }: SalesDashboardProps) {
  const kpiMetrics = useMemo(() => {
    const total = opportunities.length
    const won = opportunities.filter((o) => o.status === "won").length
    const wonRevenue = opportunities
      .filter((o) => o.status === "won")
      .reduce((sum, o) => sum + o.value, 0)
    const activeMembers = new Set(
      opportunities.map((o) => o.assignedTo).filter(Boolean)
    ).size
    const conversionRate = total > 0 ? (won / total) * 100 : 0
    return { total, won, wonRevenue, activeMembers, conversionRate }
  }, [opportunities])

  return (
    <div className="px-6 py-4 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Total Oportunidades
                </p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.total.toLocaleString()}
                </p>
              </div>
              <Target className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Miembros Activos
                </p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.activeMembers}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {kpiMetrics.activeMembers} en total
                </p>
              </div>
              <Users className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Tasa de Conversión
                </p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.conversionRate.toFixed(1)}%
                </p>
              </div>
              <TrendingUp className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Ingreso Ganado
                </p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.wonRevenue.toLocaleString("es-MX", {
                    style: "currency",
                    currency: "MXN",
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              <DollarSign className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Start dev server and verify KPI cards**

```bash
npm run dev
```

Open `http://localhost:3000`, click the **Ventas** tab.

Expected: Four cards in a 2-col (mobile) / 4-col (desktop) grid showing:
- "16" total opportunities (mock data has 16 records)
- "3" active members (Rep A, Rep B, Rep C)
- "6.3%" conversion rate (1 won out of 16)
- "MX$35,000" won revenue (only o5 has status "won", value 35000)

---

### Task 2: Add stacked bar chart and commit

**Files:**
- Modify: `components/dashboard/sales-dashboard.tsx`

- [ ] **Step 1: Add chart useMemos and render the chart card**

Replace the entire contents of `components/dashboard/sales-dashboard.tsx` with the final version:

```tsx
"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { Opportunity, Call, Message } from "@/lib/types"
import {
  Users,
  TrendingUp,
  Target,
  DollarSign,
} from "lucide-react"

interface SalesDashboardProps {
  opportunities: Opportunity[]
  calls: Call[]
  messages: Message[]
}

const STAGE_COLORS: Record<string, string> = {
  Discovery: "#3b82f6",
  Proposal: "#8b5cf6",
  Negotiation: "#f59e0b",
  "Closed Won": "#10b981",
  "Closed Lost": "#ef4444",
}

function TotalBadge({ value }: { value: number | string }) {
  return (
    <span className="ml-auto inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
      Total: {typeof value === "number" ? value.toLocaleString() : value}
    </span>
  )
}

export function SalesDashboard({ opportunities }: SalesDashboardProps) {
  const kpiMetrics = useMemo(() => {
    const total = opportunities.length
    const won = opportunities.filter((o) => o.status === "won").length
    const wonRevenue = opportunities
      .filter((o) => o.status === "won")
      .reduce((sum, o) => sum + o.value, 0)
    const activeMembers = new Set(
      opportunities.map((o) => o.assignedTo).filter(Boolean)
    ).size
    const conversionRate = total > 0 ? (won / total) * 100 : 0
    return { total, won, wonRevenue, activeMembers, conversionRate }
  }, [opportunities])

  const allStages = useMemo(
    () => [...new Set(opportunities.map((o) => o.stage))],
    [opportunities]
  )

  const chartData = useMemo(() => {
    const members = [
      ...new Set(
        opportunities
          .map((o) => o.assignedTo)
          .filter((m): m is string => Boolean(m))
      ),
    ]
    return members.map((member) => {
      const row: Record<string, string | number> = { member }
      for (const stage of allStages) {
        row[stage] = opportunities.filter(
          (o) => o.assignedTo === member && o.stage === stage
        ).length
      }
      return row
    })
  }, [opportunities, allStages])

  const chartConfig = useMemo(
    () =>
      Object.fromEntries(
        allStages.map((stage) => [
          stage,
          { label: stage, color: STAGE_COLORS[stage] ?? "#94a3b8" },
        ])
      ),
    [allStages]
  )

  return (
    <div className="px-6 py-4 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Total Oportunidades
                </p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.total.toLocaleString()}
                </p>
              </div>
              <Target className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Miembros Activos
                </p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.activeMembers}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {kpiMetrics.activeMembers} en total
                </p>
              </div>
              <Users className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Tasa de Conversión
                </p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.conversionRate.toFixed(1)}%
                </p>
              </div>
              <TrendingUp className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Ingreso Ganado
                </p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.wonRevenue.toLocaleString("es-MX", {
                    style: "currency",
                    currency: "MXN",
                    maximumFractionDigits: 0,
                  })}
                </p>
              </div>
              <DollarSign className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stacked Bar Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center pb-2">
          <CardTitle className="text-base font-semibold">
            Leads por Miembro por Etapa del Pipeline
          </CardTitle>
          <TotalBadge value={opportunities.length} />
        </CardHeader>
        <CardContent>
          {opportunities.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Sin oportunidades para mostrar
            </div>
          ) : (
            <ChartContainer
              config={chartConfig}
              style={{ height: Math.max(200, chartData.length * 64) }}
              className="w-full"
            >
              <BarChart
                data={chartData}
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
                {allStages.map((stage) => (
                  <Bar
                    key={stage}
                    dataKey={stage}
                    stackId="a"
                    fill={STAGE_COLORS[stage] ?? "#94a3b8"}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Verify chart in browser**

With the dev server still running at `http://localhost:3000`, navigate to the **Ventas** tab.

Expected:
- Chart card titled "Leads por Miembro por Etapa del Pipeline" with "Total: 16" badge
- Three horizontal bars (Rep A, Rep B, Rep C), each segmented by stage color
- Hovering a segment shows a tooltip with stage name and count
- Legend shows all stages with their colors below the chart

- [ ] **Step 3: Check TypeScript build**

```bash
npm run build
```

Expected: Build completes (TypeScript errors are ignored per `next.config.mjs`, but no import errors should appear).

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/sales-dashboard.tsx docs/superpowers/specs/2026-05-21-sales-dashboard-kpi-chart-design.md docs/superpowers/plans/2026-05-21-sales-dashboard-kpi-chart.md
git commit -m "feat(sales): add KPI cards and opportunities-by-member stacked bar chart"
```
