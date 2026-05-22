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

const WIN_LOSS_CONFIG = {
  won:       { label: "Ganado",           color: "#10b981" },
  open:      { label: "Abierto",          color: "#3b82f6" },
  lost:      { label: "Perdido",          color: "#ef4444" },
  abandoned: { label: "Abandonado",       color: "#94a3b8" },
  winRate:   { label: "Tasa de Ganancia", color: "transparent" },
} as const

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

  const revenueData = useMemo(
    () =>
      members
        .map((member) => ({
          member,
          revenue: opportunities
            .filter((o) => o.assignedTo === member && o.status === "won")
            .reduce((sum, o) => sum + o.value, 0),
        }))
        .filter((d) => d.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue),
    [members, opportunities]
  )

  const chartData = useMemo(() => {
    return members.map((member) => {
      const row: Record<string, string | number> = { member }
      for (const stage of allStages) {
        row[stage] = opportunities.filter((o) => o.assignedTo === member && o.stage === stage).length
      }
      return row
    })
  }, [members, allStages, opportunities])

  const chartConfig = useMemo(
    () => Object.fromEntries(allStages.map((stage, i) => [stage, { label: stage, color: stageColor(stage, i) }])),
    [allStages]
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

        {/* Chart B: Ingreso Ganado por Asesor */}
        <Card>
          <CardHeader className="flex flex-row items-center pb-2">
            <CardTitle className="text-base font-semibold">
              Ingreso Ganado por Asesor
            </CardTitle>
          </CardHeader>
          <CardContent>
            {revenueData.length === 0 ? (
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
      </div>

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
