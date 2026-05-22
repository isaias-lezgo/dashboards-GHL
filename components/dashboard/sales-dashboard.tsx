"use client"

import { useState, useCallback, useMemo } from "react"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LabelList,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { Opportunity, Contact, Call, Message, Task } from "@/lib/types"
import { Users, TrendingUp, Target, DollarSign } from "lucide-react"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"

interface SalesDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  calls: Call[]
  messages: Message[]
  tasks?: Task[]
}

const STAGE_COLORS: Record<string, string> = {
  Discovery:    "#3b82f6",
  Proposal:     "#8b5cf6",
  Negotiation:  "#f59e0b",
  "Closed Won": "#10b981",
  "Closed Lost":"#ef4444",
}

const COLOR_PALETTE = [
  "#3b82f6","#8b5cf6","#f59e0b","#10b981","#ef4444",
  "#f97316","#06b6d4","#84cc16","#ec4899","#a855f7",
]

function stageColor(stage: string, index: number): string {
  return STAGE_COLORS[stage] ?? COLOR_PALETTE[index % COLOR_PALETTE.length]
}

function TotalBadge({ value }: { value: number | string }) {
  return (
    <span className="ml-auto inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
      Total: {typeof value === "number" ? value.toLocaleString() : value}
    </span>
  )
}

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

export function SalesDashboard({ opportunities, contacts, calls, tasks = [] }: SalesDashboardProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)

  const openDrill = useCallback((title: string, items: Opportunity[], subtitle?: string) => {
    setDrill({ open: true, title, subtitle, opportunities: items })
  }, [])

  const kpiMetrics = useMemo(() => {
    const total = opportunities.length
    const won = opportunities.filter((o) => o.status === "won").length
    const wonRevenue = opportunities.filter((o) => o.status === "won").reduce((sum, o) => sum + o.value, 0)
    const activeMembers = new Set(opportunities.map((o) => o.assignedTo).filter(Boolean)).size
    const conversionRate = total > 0 ? (won / total) * 100 : 0
    return { total, won, wonRevenue, activeMembers, conversionRate }
  }, [opportunities])

  const allStages = useMemo(
    () => [...new Set(opportunities.map((o) => o.stage))],
    [opportunities]
  )

  const chartData = useMemo(() => {
    const members = [...new Set(opportunities.map((o) => o.assignedTo).filter((m): m is string => Boolean(m)))]
    return members.map((member) => {
      const row: Record<string, string | number> = { member }
      for (const stage of allStages) {
        row[stage] = opportunities.filter((o) => o.assignedTo === member && o.stage === stage).length
      }
      return row
    })
  }, [opportunities, allStages])

  const chartConfig = useMemo(
    () => Object.fromEntries(allStages.map((stage, i) => [stage, { label: stage, color: stageColor(stage, i) }])),
    [allStages]
  )

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

  return (
    <div className="px-6 py-4 space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          className="cursor-pointer hover:border-primary/40 hover:bg-accent/20 transition-all"
          onClick={() => openDrill("Todas las Oportunidades", opportunities)}
        >
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Oportunidades</p>
                <p className="text-3xl font-bold mt-1">{kpiMetrics.total.toLocaleString()}</p>
              </div>
              <Target className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/40 hover:bg-accent/20 transition-all"
          onClick={() => openDrill("Miembros del Equipo", opportunities, `${kpiMetrics.activeMembers} miembros activos`)}
        >
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Miembros Activos</p>
                <p className="text-3xl font-bold mt-1">{kpiMetrics.activeMembers}</p>
                <p className="text-xs text-muted-foreground mt-1">{kpiMetrics.activeMembers} en total</p>
              </div>
              <Users className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/40 hover:bg-accent/20 transition-all"
          onClick={() => openDrill("Oportunidades Ganadas", opportunities.filter((o) => o.status === "won"))}
        >
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Tasa de Conversión</p>
                <p className="text-3xl font-bold mt-1">{kpiMetrics.conversionRate.toFixed(1)}%</p>
                <p className="text-xs text-muted-foreground mt-1">{kpiMetrics.won} ganadas</p>
              </div>
              <TrendingUp className="h-5 w-5 text-blue-500 mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/40 hover:bg-accent/20 transition-all"
          onClick={() => openDrill("Oportunidades Ganadas", opportunities.filter((o) => o.status === "won"), "Ingreso ganado total")}
        >
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Ingreso Ganado</p>
                <p className="text-3xl font-bold mt-1">
                  {kpiMetrics.wonRevenue.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })}
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
          <CardTitle className="text-base font-semibold">Leads por Miembro por Etapa del Pipeline</CardTitle>
          <TotalBadge value={opportunities.length} />
        </CardHeader>
        <CardContent>
          {opportunities.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Sin oportunidades para mostrar
            </div>
          ) : (
            <>
              <ChartContainer config={chartConfig} style={{ height: Math.max(200, chartData.length * 64) }} className="w-full">
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <YAxis dataKey="member" type="category" width={68} tick={{ fontSize: 12 }} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  {allStages.map((stage, i) => (
                    <Bar
                      key={stage}
                      dataKey={stage}
                      stackId="a"
                      fill={stageColor(stage, i)}
                      cursor="pointer"
                      onClick={(data: any) => {
                        const member = data.member as string
                        openDrill(
                          `${member} · ${stage}`,
                          opportunities.filter((o) => o.assignedTo === member && o.stage === stage)
                        )
                      }}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">Haz clic en un segmento para ver los leads</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Drill-down drawer */}
      <ChartDrillDrawer
        drill={drill}
        onDrillChange={setDrill}
        contacts={contacts}
        tasks={tasks}
        calls={calls}
        allOpportunities={opportunities}
      />
    </div>
  )
}
