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
  Cell,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { Opportunity, Contact, Call, Message, Task, Appointment } from "@/lib/types"
import { Users, TrendingUp, Target, DollarSign, Info } from "lucide-react"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"
import {
  AppointmentDrillDrawer,
  APPT_DRILL_CLOSED,
  type ApptDrillState,
} from "./appointment-drill-drawer"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface SalesDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  calls: Call[]
  messages: Message[]
  appointments: Appointment[]
  tasks?: Task[]
  members?: string[]
  locationId?: string
}

const STAGE_COLORS: Record<string, string> = {
  Discovery:    "#335577",
  Proposal:     "#5a8ab5",
  Negotiation:  "#F59B1B",
  "Closed Won": "#F59B1B",
  "Closed Lost":"#ef4444",
}

const COLOR_PALETTE = [
  "#F59B1B","#335577","#10b981","#8b5cf6","#ef4444",
  "#f97316","#06b6d4","#84cc16","#ec4899","#a855f7",
]

const WIN_LOSS_CONFIG = {
  won:       { label: "Ganado",           color: "#F59B1B" },
  open:      { label: "Abierto",          color: "#335577" },
  lost:      { label: "Perdido",          color: "#ef4444" },
  abandoned: { label: "Abandonado",       color: "#94a3b8" },
  winRate:   { label: "Tasa de Ganancia", color: "transparent" },
} as const

const PIPELINE_STAGE_ORDER = ["Discovery", "Proposal", "Negotiation"]

const APPT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  showed:    { label: "Asistió",    color: "#10b981" },
  confirmed: { label: "Confirmada", color: "#335577" },
  new:       { label: "Pendiente",  color: "#F59B1B" },
  noshow:    { label: "No asistió", color: "#ef4444" },
  cancelled: { label: "Cancelada",  color: "#94a3b8" },
  invalid:   { label: "Inválida",   color: "#6b7280" },
}

const KNOWN_APPT_STATUS_ORDER = ["showed", "confirmed", "new", "noshow", "cancelled", "invalid"]

function apptStatusVisual(status: string, fallbackIndex: number): { label: string; color: string } {
  const known = APPT_STATUS_CONFIG[status]
  if (known) return known
  return {
    label: status.charAt(0).toUpperCase() + status.slice(1),
    color: COLOR_PALETTE[fallbackIndex % COLOR_PALETTE.length],
  }
}

function stageColor(stage: string, index: number): string {
  return STAGE_COLORS[stage] ?? COLOR_PALETTE[index % COLOR_PALETTE.length]
}

function isBusinessHoursStr(isoStr: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(isoStr))
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
  return !["Sat", "Sun"].includes(weekday) && hour >= 9 && hour < 19
}

function nextBusinessOpenMs(isoStr: string): number {
  const d = new Date(isoStr)
  let candidate = new Date(d)
  candidate.setUTCMinutes(0, 0, 0)
  candidate.setUTCMilliseconds(0)
  if (candidate.getTime() <= d.getTime()) {
    candidate = new Date(candidate.getTime() + 3_600_000)
  }
  for (let h = 0; h < 168; h++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Mexico_City",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(candidate)
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? ""
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
    if (!["Sat", "Sun"].includes(weekday) && hour === 9) return candidate.getTime()
    candidate = new Date(candidate.getTime() + 3_600_000)
  }
  return d.getTime()
}

function responseColor(minutes: number): string {
  if (minutes < 30) return "#10b981"
  if (minutes <= 60) return "#F59B1B"
  return "#ef4444"
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

function TotalBadge({ value }: { value: number | string }) {
  return (
    <span className="ml-auto inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
      Total: {typeof value === "number" ? value.toLocaleString() : value}
    </span>
  )
}

function InfoTooltip({ content }: { content: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help shrink-0 inline-flex ml-1">
            <Info size={14} className="text-muted-foreground" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

export function SalesDashboard({ opportunities, contacts, calls, messages = [], appointments = [], tasks = [], members: membersProp = [], locationId = "" }: SalesDashboardProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const [apptDrill, setApptDrill] = useState<ApptDrillState>(APPT_DRILL_CLOSED)

  const openDrill = useCallback((title: string, items: Opportunity[], subtitle?: string) => {
    setDrill({ open: true, title, subtitle, opportunities: items })
  }, [])

  const openDrillContacts = useCallback((title: string, contactIds: string[]) => {
    const idSet = new Set(contactIds)
    openDrill(title, opportunities.filter((o) => idSet.has(o.contactId)))
  }, [opportunities, openDrill])

  const kpiMetrics = useMemo(() => {
    const total = opportunities.length
    const won = opportunities.filter((o) => o.status === "won").length
    const wonRevenue = opportunities.filter((o) => o.status === "won").reduce((sum, o) => sum + o.value, 0)
    const activeMembers = membersProp.length > 0
      ? membersProp.length
      : new Set(opportunities.map((o) => o.assignedTo).filter(Boolean)).size
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
          _total:    opps.length,
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
    const oppsByBucket = new Map<string, Opportunity[]>()
    for (const opp of opportunities) {
      const raw = opp.createdAt
      const d = raw.length === 10
        ? new Date(`${raw}T00:00:00`)
        : new Date(raw)
      if (Number.isNaN(d.getTime())) continue
      let key: string
      if (useMonths) {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      } else {
        const tmp = new Date(d.getTime())
        tmp.setHours(0, 0, 0, 0)
        tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7))
        const week1 = new Date(tmp.getFullYear(), 0, 4)
        const isoWeek = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
        key = `${tmp.getFullYear()}-W${String(isoWeek).padStart(2, "0")}`
      }
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
      if (!oppsByBucket.has(key)) oppsByBucket.set(key, [])
      oppsByBucket.get(key)!.push(opp)
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({
        period: useMonths
          ? (() => {
              const [y, m] = key.split("-").map(Number)
              return new Date(y, m - 1).toLocaleDateString("es-MX", {
                month: "short",
                year: "numeric",
              })
            })()
          : `Sem ${key.split("-W")[1]}`,
        count,
        opps: oppsByBucket.get(key) ?? [],
      }))
  }, [opportunities])

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

  const dailyConvData = useMemo(() => {
    if (messages.length === 0) return []
    const dailyConvMap = new Map<string, Set<string>>()
    const dailyContactMap = new Map<string, Set<string>>()
    for (const msg of messages) {
      if (!msg.conversationId) continue
      const date = msg.createdAt.slice(0, 10)
      if (!dailyConvMap.has(date)) dailyConvMap.set(date, new Set())
      dailyConvMap.get(date)!.add(msg.conversationId)
      if (!dailyContactMap.has(date)) dailyContactMap.set(date, new Set())
      dailyContactMap.get(date)!.add(msg.contactId)
    }
    return [...dailyConvMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, convSet]) => ({
        date,
        label: new Date(date + "T12:00:00").toLocaleDateString("es-MX", {
          day: "2-digit",
          month: "short",
        }),
        count: convSet.size,
        contactIds: [...(dailyContactMap.get(date) ?? new Set<string>())],
      }))
  }, [messages])

  const convByAdvisorMonthData = useMemo(() => {
    const threads = new Map<string, typeof messages>()
    for (const msg of messages) {
      if (!msg.conversationId) continue
      if (!threads.has(msg.conversationId)) threads.set(msg.conversationId, [])
      threads.get(msg.conversationId)!.push(msg)
    }
    for (const thread of threads.values()) {
      thread.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }

    // Pivot: month (YYYY-MM) → advisor → unique conv count
    const advisorSet = new Set<string>()
    const monthMap = new Map<string, Map<string, number>>()
    const contactIdMap = new Map<string, Map<string, string[]>>()
    let totalConvs = 0
    for (const [, thread] of threads.entries()) {
      const advisor =
        thread.find((m) => m.direction === "outbound" && m.kind !== "activity")?.assignedTo
        ?? thread[0]?.assignedTo
      if (!advisor || thread.length === 0) continue
      const month = thread[0].createdAt.slice(0, 7) // "YYYY-MM"
      const contactId = thread[0].contactId
      advisorSet.add(advisor)
      if (!monthMap.has(month)) monthMap.set(month, new Map())
      const row = monthMap.get(month)!
      row.set(advisor, (row.get(advisor) ?? 0) + 1)
      if (contactId) {
        if (!contactIdMap.has(month)) contactIdMap.set(month, new Map())
        const monthContacts = contactIdMap.get(month)!
        if (!monthContacts.has(advisor)) monthContacts.set(advisor, [])
        monthContacts.get(advisor)!.push(contactId)
      }
      totalConvs++
    }

    const advisors = [...advisorSet].sort()
    const months = [...monthMap.keys()].sort()
    const data = months.map((month) => {
      const [y, m] = month.split("-").map(Number)
      const label = new Date(y, m - 1, 1).toLocaleDateString("es-MX", {
        month: "short",
        year: "numeric",
      })
      const row: Record<string, string | number> = { month, label }
      for (const advisor of advisors) {
        row[advisor] = monthMap.get(month)!.get(advisor) ?? 0
      }
      return row
    })
    return { data, advisors, totalConvs, contactIdMap }
  }, [messages])

  const responseTimeData = useMemo(() => {
    const threads = new Map<string, typeof messages>()
    for (const msg of messages) {
      if (!msg.conversationId) continue
      if (!threads.has(msg.conversationId)) threads.set(msg.conversationId, [])
      threads.get(msg.conversationId)!.push(msg)
    }
    for (const thread of threads.values()) {
      thread.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }

    const advisorDeltas = new Map<string, number[]>()
    for (const thread of threads.values()) {
      for (let i = 0; i < thread.length; i++) {
        const msg = thread[i]
        if (msg.direction !== "inbound" || msg.kind === "activity") continue
        const reply = thread.slice(i + 1).find(
          (m) => m.direction === "outbound" && m.kind !== "activity"
        )
        if (!reply) continue
        const advisor = reply.assignedTo
        if (!advisor) continue
        const clockStart = isBusinessHoursStr(msg.createdAt)
          ? new Date(msg.createdAt).getTime()
          : nextBusinessOpenMs(msg.createdAt)
        const delta = new Date(reply.createdAt).getTime() - clockStart
        if (delta <= 0) continue
        if (!advisorDeltas.has(advisor)) advisorDeltas.set(advisor, [])
        advisorDeltas.get(advisor)!.push(delta)
      }
    }

    return [...advisorDeltas.entries()]
      .map(([member, deltas]) => ({
        member,
        avgMinutes: deltas.reduce((s, d) => s + d, 0) / deltas.length / 60_000,
      }))
      .sort((a, b) => a.avgMinutes - b.avgMinutes)
  }, [messages])

  const apptByMonthByAdvisor = useMemo(() => {
    const monthMap = new Map<string, Map<string, Map<string, number>>>()
    const advisorSet = new Set<string>()
    const statusSet = new Set<string>()
    let total = 0

    for (const appt of appointments) {
      if (!appt.assignedTo) continue
      const month = appt.startTime.slice(0, 7)
      const advisor = appt.assignedTo
      const status = appt.status
      advisorSet.add(advisor)
      statusSet.add(status)
      total++
      if (!monthMap.has(month)) monthMap.set(month, new Map())
      const advisorMap = monthMap.get(month)!
      if (!advisorMap.has(advisor)) advisorMap.set(advisor, new Map())
      const statusMap = advisorMap.get(advisor)!
      statusMap.set(status, (statusMap.get(status) ?? 0) + 1)
    }

    const advisors = [...advisorSet].sort()
    const statuses = [...statusSet].sort((a, b) => {
      const ai = KNOWN_APPT_STATUS_ORDER.indexOf(a)
      const bi = KNOWN_APPT_STATUS_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })

    const months = [...monthMap.keys()].sort()
    const data = months.map((month) => {
      const [y, m] = month.split("-").map(Number)
      const label = new Date(y, m - 1, 1).toLocaleDateString("es-MX", {
        month: "short",
        year: "numeric",
      })
      const row: Record<string, string | number> = { month, label }
      for (const advisor of advisors) {
        for (const status of statuses) {
          row[`${advisor}_${status}`] =
            monthMap.get(month)?.get(advisor)?.get(status) ?? 0
        }
      }
      return row
    })

    return { data, advisors, statuses, total }
  }, [appointments])

  const apptChartConfig = useMemo(
    () =>
      Object.fromEntries(
        apptByMonthByAdvisor.advisors.flatMap((advisor) =>
          apptByMonthByAdvisor.statuses.map((status, si) => [
            `${advisor}_${status}`,
            {
              label: `${advisor} · ${apptStatusVisual(status, si).label}`,
              color: apptStatusVisual(status, si).color,
            },
          ])
        )
      ),
    [apptByMonthByAdvisor.advisors, apptByMonthByAdvisor.statuses]
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
              <Target className="h-5 w-5 text-muted-foreground mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/40 hover:bg-accent/20 transition-all"
          onClick={() => setDrill({ open: true, title: "Miembros del Equipo", subtitle: `${kpiMetrics.activeMembers} asesores`, opportunities, members: membersProp.length > 0 ? membersProp : [...new Set(opportunities.map((o) => o.assignedTo).filter(Boolean) as string[])] })}
        >
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Miembros Activos</p>
                <p className="text-3xl font-bold mt-1">{kpiMetrics.activeMembers}</p>
                <p className="text-xs text-muted-foreground mt-1">{kpiMetrics.activeMembers} en total</p>
              </div>
              <Users className="h-5 w-5 mt-1" style={{ color: "#335577" }} />
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
              <TrendingUp className="h-5 w-5 text-primary mt-1" />
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
              <DollarSign className="h-5 w-5 text-primary mt-1" />
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
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#DDE2EA" />
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
              <>
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
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#DDE2EA" />
                  <YAxis
                    dataKey="member"
                    type="category"
                    width={68}
                    tick={{ fontSize: 12 }}
                  />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Bar dataKey="won" stackId="a" fill={WIN_LOSS_CONFIG.won.color} cursor="pointer"
                    onClick={(data: any) => openDrill(`${data.member} · Ganado`, opportunities.filter((o) => o.assignedTo === data.member && o.status === "won"))}
                  />
                  <Bar dataKey="open" stackId="a" fill={WIN_LOSS_CONFIG.open.color} cursor="pointer"
                    onClick={(data: any) => openDrill(`${data.member} · Abierto`, opportunities.filter((o) => o.assignedTo === data.member && o.status === "open"))}
                  />
                  <Bar dataKey="lost" stackId="a" fill={WIN_LOSS_CONFIG.lost.color} cursor="pointer"
                    onClick={(data: any) => openDrill(`${data.member} · Perdido`, opportunities.filter((o) => o.assignedTo === data.member && o.status === "lost"))}
                  />
                  <Bar dataKey="abandoned" stackId="a" fill={WIN_LOSS_CONFIG.abandoned.color} cursor="pointer"
                    onClick={(data: any) => openDrill(`${data.member} · Abandonado`, opportunities.filter((o) => o.assignedTo === data.member && o.status === "abandoned"))}
                  >
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
              <p className="mt-2 text-center text-[10px] text-muted-foreground">Haz clic en un segmento para ver los leads</p>
              </>
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
              <>
              <ChartContainer
                config={{ revenue: { label: "Ingreso Ganado", color: "#F59B1B" } }}
                style={{ height: Math.max(200, revenueData.length * 64) }}
                className="w-full"
              >
                <BarChart
                  data={revenueData}
                  layout="vertical"
                  margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#DDE2EA" />
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
                  <Bar dataKey="revenue" fill="#F59B1B" cursor="pointer"
                    onClick={(data: any) => openDrill(`${data.member} · Ingreso Ganado`, opportunities.filter((o) => o.assignedTo === data.member && o.status === "won"))}
                  />
                </BarChart>
              </ChartContainer>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver los leads</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tiempo promedio de respuesta - full width */}
      {responseTimeData.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center pb-2">
            <CardTitle className="text-base font-semibold flex items-center">
              Tiempo promedio de respuesta del asesor
              <InfoTooltip content="Tiempo promedio que tarda un asesor en responder un mensaje entrante, calculado solo en horario laboral (lun–vie 9am–6pm). Considera únicamente la primera respuesta saliente por hilo de conversación." />
            </CardTitle>
            <TotalBadge value={`${responseTimeData.length} asesores`} />
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{ avgMinutes: { label: "Tiempo de respuesta", color: "#F59B1B" } }}
              style={{ height: Math.max(200, responseTimeData.length * 64) }}
              className="w-full"
            >
              <BarChart
                data={responseTimeData}
                layout="vertical"
                margin={{ left: 8, right: 80, top: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#DDE2EA" />
                <YAxis
                  dataKey="member"
                  type="category"
                  width={68}
                  tick={{ fontSize: 12 }}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${Math.round(v as number)}m`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) =>
                        typeof value === "number" ? formatMinutes(value) : String(value)
                      }
                    />
                  }
                />
                <Bar dataKey="avgMinutes" radius={[0, 3, 3, 0]}>
                  {responseTimeData.map((entry) => (
                    <Cell key={entry.member} fill={responseColor(entry.avgMinutes)} />
                  ))}
                  <LabelList
                    dataKey="avgMinutes"
                    position="right"
                    formatter={(v: unknown) =>
                      typeof v === "number" ? formatMinutes(v) : ""
                    }
                    style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

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
              <>
              <ChartContainer
                config={{ value: { label: "Valor en Pipeline", color: "#335577" } }}
                style={{ height: Math.max(200, pipelineValueData.length * 64) }}
                className="w-full"
              >
                <BarChart
                  data={pipelineValueData}
                  layout="vertical"
                  margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#DDE2EA" />
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
                  <Bar dataKey="value" fill="#335577" cursor="pointer"
                    onClick={(data: any) => openDrill(`Pipeline: ${data.stage}`, opportunities.filter((o) => o.status === "open" && o.stage === data.stage))}
                  />
                </BarChart>
              </ChartContainer>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver los leads</p>
              </>
            )}
          </CardContent>
        </Card>

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
              <>
              <ChartContainer
                config={{ count: { label: "Nuevas Oportunidades", color: "#F59B1B" } }}
                style={{ height: 220 }}
                className="w-full"
              >
                <BarChart
                  data={trendData}
                  margin={{ left: 8, right: 8, top: 8, bottom: 48 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#DDE2EA" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11 }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="#F59B1B" radius={[3, 3, 0, 0]} cursor="pointer"
                    onClick={(data: any) => openDrill(`Período: ${data.period}`, data.opps ?? [])}
                  />
                </BarChart>
              </ChartContainer>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver los leads</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Actividad de Conversaciones ─────────────── */}
      <SectionHeader title="Actividad de Conversaciones" />
      <Card>
        <CardHeader className="flex flex-row items-center pb-2">
          <CardTitle className="text-base font-semibold flex items-center">
            Conversaciones únicas por día
            <InfoTooltip content="Cuenta hilos de conversación distintos que tuvieron al menos un mensaje ese día, sin importar el canal ni la hora." />
          </CardTitle>
          <TotalBadge value={new Set(messages.map((m) => m.conversationId).filter(Boolean)).size} />
        </CardHeader>
        <CardContent>
          {dailyConvData.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Sin datos de conversaciones
            </div>
          ) : (
            <>
              <ChartContainer
                config={{ count: { label: "Conversaciones", color: "#06b6d4" } }}
                style={{ height: 220 }}
                className="w-full"
              >
                <BarChart
                  data={dailyConvData}
                  margin={{ left: 8, right: 8, top: 8, bottom: dailyConvData.length > 10 ? 48 : 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#DDE2EA" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    angle={dailyConvData.length > 10 ? -35 : 0}
                    textAnchor={dailyConvData.length > 10 ? "end" : "middle"}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="count"
                    fill="#06b6d4"
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    onClick={(data: any) =>
                      openDrillContacts(`Conversaciones del ${data.label}`, data.contactIds ?? [])
                    }
                  />
                </BarChart>
              </ChartContainer>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver los contactos</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center pb-2">
          <CardTitle className="text-base font-semibold flex items-center">
            Conversaciones únicas por asesor
            <InfoTooltip content="Número de conversaciones únicas atendidas por cada asesor, agrupadas por el mes del primer mensaje del hilo." />
          </CardTitle>
          <TotalBadge value={convByAdvisorMonthData.totalConvs} />
        </CardHeader>
        <CardContent>
          {convByAdvisorMonthData.data.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Sin datos de conversaciones
            </div>
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  convByAdvisorMonthData.advisors.map((advisor, i) => [
                    advisor,
                    { label: advisor, color: COLOR_PALETTE[i % COLOR_PALETTE.length] },
                  ])
                )}
                style={{ height: 320 }}
                className="w-full"
              >
                <BarChart
                  data={convByAdvisorMonthData.data}
                  margin={{ left: 8, right: 8, top: 16, bottom: 32 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#DDE2EA" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  {convByAdvisorMonthData.advisors.map((advisor, i) => (
                    <Bar
                      key={advisor}
                      dataKey={advisor}
                      stackId="conv"
                      fill={COLOR_PALETTE[i % COLOR_PALETTE.length]}
                      radius={
                        i === convByAdvisorMonthData.advisors.length - 1
                          ? [3, 3, 0, 0]
                          : [0, 0, 0, 0]
                      }
                      cursor="pointer"
                      onClick={(data: any) => {
                        const ids = convByAdvisorMonthData.contactIdMap.get(data.month as string)?.get(advisor) ?? []
                        openDrillContacts(`${advisor} · ${data.label}`, ids)
                      }}
                    />
                  ))}
                </BarChart>
              </ChartContainer>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">Haz clic en un segmento para ver los contactos</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Citas ──────────────────────────────────── */}
      <SectionHeader title="Citas" />
      <Card>
        <CardHeader className="flex flex-row items-center pb-2">
          <CardTitle className="text-base font-semibold flex items-center">
            Citas por mes por asesor
            <InfoTooltip content="Citas (calendar events) agrupadas por mes. Cada mes muestra una barra por asesor, desglosada por estatus. Ventana fija: últimos 90 días." />
          </CardTitle>
          <TotalBadge value={apptByMonthByAdvisor.total} />
        </CardHeader>
        <CardContent>
          {apptByMonthByAdvisor.data.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Sin citas para mostrar
            </div>
          ) : (
            <>
              <ChartContainer
                config={apptChartConfig}
                style={{ height: 320 }}
                className="w-full"
              >
                <BarChart
                  data={apptByMonthByAdvisor.data}
                  margin={{ left: 8, right: 8, top: 16, bottom: 32 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#DDE2EA" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend
                    content={() => (
                      <div className="flex flex-wrap gap-3 justify-center pt-2">
                        {apptByMonthByAdvisor.statuses.map((status, i) => {
                          const { label, color } = apptStatusVisual(status, i)
                          return (
                            <span key={status} className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                              {label}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  />
                  {apptByMonthByAdvisor.advisors.flatMap((advisor) =>
                    apptByMonthByAdvisor.statuses.map((status, si) => (
                      <Bar
                        key={`${advisor}_${status}`}
                        dataKey={`${advisor}_${status}`}
                        stackId={advisor}
                        fill={apptStatusVisual(status, si).color}
                        name={`${advisor} · ${apptStatusVisual(status, si).label}`}
                        legendType="none"
                        cursor="pointer"
                        radius={
                          si === apptByMonthByAdvisor.statuses.length - 1
                            ? [3, 3, 0, 0]
                            : [0, 0, 0, 0]
                        }
                        onClick={(data: any) => {
                          const matched = appointments.filter(
                            (a) =>
                              a.assignedTo === advisor &&
                              a.startTime.slice(0, 7) === (data.month as string) &&
                              a.status === status
                          )
                          setApptDrill({
                            open: true,
                            title: `${advisor} · ${apptStatusVisual(status, si).label} · ${data.label as string}`,
                            appointments: matched,
                          })
                        }}
                      />
                    ))
                  )}
                </BarChart>
              </ChartContainer>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Haz clic en un segmento para ver las citas
              </p>
            </>
          )}
        </CardContent>
      </Card>

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
            <>
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
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#DDE2EA" />
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
                    cursor="pointer"
                    onClick={(data: any) => openDrill(
                      `${data.member} · ${reason}`,
                      opportunities.filter((o) => o.assignedTo === data.member && o.status === "lost" && (o.lostReason ?? "Sin razón") === reason)
                    )}
                  />
                ))}
              </BarChart>
            </ChartContainer>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">Haz clic en un segmento para ver los leads</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Appointment drill-down drawer */}
      <AppointmentDrillDrawer
        drill={apptDrill}
        onDrillChange={setApptDrill}
        contacts={contacts}
      />

      {/* Drill-down drawer */}
      <ChartDrillDrawer
        drill={drill}
        onDrillChange={setDrill}
        contacts={contacts}
        tasks={tasks}
        calls={calls}
        allOpportunities={opportunities}
        appointments={appointments}
        locationId={locationId}
      />
    </div>
  )
}
