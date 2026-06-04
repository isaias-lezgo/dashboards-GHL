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
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import type { Opportunity, Contact, Call, Message, Task, Appointment, Pauta } from "@/lib/types"
import { Users, TrendingUp, Target, DollarSign, Info } from "lucide-react"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"
import {
  BRAND_AMBER,
  STRUCTURAL_NAVY,
  CHART_PALETTE,
  CHART_GRID_STROKE,
  CHART_TICK,
  chartPaletteColor,
  DashboardShell,
  DashboardCard,
  ChartCardHeader,
  ChartCardContent,
  ChartEmpty,
  ChartHint,
  KpiCard,
  SectionHeader,
  TotalBadge,
  NonZeroTooltipContent,
} from "./dashboard-ui"
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
  messagesLoading?: boolean
  appointments: Appointment[]
  tasks?: Task[]
  pautas?: Pauta[]
  members?: string[]
  locationId?: string
  onAnalyzeWithAI?: (initialMessage: string) => void
}

// Vertical breathing room under the plot so angled X-axis (column) labels
// don't collide with the legend swatches sitting directly below them.
const LEGEND_WRAPPER_STYLE = { paddingTop: 28 }

const STAGE_COLORS: Record<string, string> = {
  Discovery:    "#335577",
  Proposal:     "#5a8ab5",
  Negotiation:  "#F59B1B",
  "Closed Won": "#F59B1B",
  "Closed Lost":"#ef4444",
}

// CHART_PALETTE from dashboard-ui (amber-led)

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
    color: chartPaletteColor(fallbackIndex),
  }
}

function stageColor(stage: string, index: number): string {
  return STAGE_COLORS[stage] ?? chartPaletteColor(index)
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

export function SalesDashboard({ opportunities, contacts, calls, messages = [], messagesLoading = false, appointments = [], tasks = [], pautas = [], members: membersProp = [], locationId = "", onAnalyzeWithAI }: SalesDashboardProps) {
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
    const open = opportunities.filter((o) => o.status === "open").length
    const lost = opportunities.filter((o) => o.status === "lost").length
    const abandoned = opportunities.filter((o) => o.status === "abandoned").length
    const wonRevenue = opportunities.filter((o) => o.status === "won").reduce((sum, o) => sum + o.value, 0)
    const activeMembers = membersProp.length > 0
      ? membersProp.length
      : new Set(opportunities.map((o) => o.assignedTo).filter(Boolean)).size
    const conversionRate = total > 0 ? (won / total) * 100 : 0
    return { total, won, open, lost, abandoned, wonRevenue, activeMembers, conversionRate }
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
      }).sort((a, b) => b._total - a._total),
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
    const data = lostMembers.map((member) => {
      const row: Record<string, string | number> = { member }
      for (const reason of reasons) {
        row[reason] = lostOpps.filter(
          (o) =>
            o.assignedTo === member &&
            (o.lostReason ?? "Sin razón") === reason
        ).length
      }
      return row
    }).sort((a, b) => {
      const totalA = reasons.reduce((s, r) => s + ((a[r] as number) || 0), 0)
      const totalB = reasons.reduce((s, r) => s + ((b[r] as number) || 0), 0)
      return totalB - totalA
    })
    return { data, reasons }
  }, [opportunities])

  const lostReasonsConfig = useMemo(
    () =>
      Object.fromEntries(
        lostReasonsData.reasons.map((reason, i) => [
          reason,
          { label: reason, color: CHART_PALETTE[i % CHART_PALETTE.length] },
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

  const emptyFieldsData = useMemo(() => {
    const STANDARD_FIELDS = ["value", "source", "notes", "tags", "priority"] as const

    function isStandardEmpty(opp: Opportunity, field: typeof STANDARD_FIELDS[number]): boolean {
      switch (field) {
        case "value":
          return !opp.value || opp.value === 0
        case "tags":
          return !opp.tags || opp.tags.length === 0
        case "source":
        case "notes":
        case "priority": {
          const v = opp[field]
          return v == null || (typeof v === "string" && v.trim() === "")
        }
      }
    }

    const universeCustomKeys = new Set<string>()
    for (const opp of opportunities) {
      if (opp.customFieldsResolved) {
        for (const k of Object.keys(opp.customFieldsResolved)) {
          universeCustomKeys.add(k)
        }
      }
    }
    const customKeys = [...universeCustomKeys]

    function countEmpty(opp: Opportunity): { standard: number; custom: number; total: number } {
      let standard = 0
      for (const f of STANDARD_FIELDS) {
        if (isStandardEmpty(opp, f)) standard++
      }
      let custom = 0
      const cf = opp.customFieldsResolved ?? {}
      for (const k of customKeys) {
        const v = cf[k]
        if (v == null || (typeof v === "string" && v.trim() === "")) custom++
      }
      return { standard, custom, total: standard + custom }
    }

    const byAdvisor = new Map<string, { opps: Opportunity[]; perOpp: Map<string, number>; totalStandard: number; totalCustom: number }>()
    for (const opp of opportunities) {
      if (!opp.assignedTo) continue
      const counts = countEmpty(opp)
      if (!byAdvisor.has(opp.assignedTo)) {
        byAdvisor.set(opp.assignedTo, { opps: [], perOpp: new Map(), totalStandard: 0, totalCustom: 0 })
      }
      const entry = byAdvisor.get(opp.assignedTo)!
      entry.opps.push(opp)
      entry.perOpp.set(opp.id, counts.total)
      entry.totalStandard += counts.standard
      entry.totalCustom += counts.custom
    }

    const rows = [...byAdvisor.entries()].map(([member, entry]) => {
      const n = entry.opps.length
      const avgStandard = n > 0 ? entry.totalStandard / n : 0
      const avgCustom = n > 0 ? entry.totalCustom / n : 0
      return {
        member,
        avgStandard,
        avgCustom,
        avgTotal: avgStandard + avgCustom,
        totalOpps: n,
        totalStandard: entry.totalStandard,
        totalCustom: entry.totalCustom,
        opps: entry.opps,
        perOpp: entry.perOpp,
      }
    })

    rows.sort((a, b) => b.avgTotal - a.avgTotal)

    return { rows, customKeysCount: customKeys.length, standardKeysCount: STANDARD_FIELDS.length }
  }, [opportunities])

  const callsByAdvisorData = useMemo(() => {
    const byAdvisor = new Map<
      string,
      { completed: number; missed: number; noAnswer: number; total: number; contactIds: { completed: string[]; missed: string[]; noAnswer: string[] } }
    >()
    for (const c of calls) {
      if (!c.assignedTo) continue
      if (!byAdvisor.has(c.assignedTo)) {
        byAdvisor.set(c.assignedTo, {
          completed: 0,
          missed: 0,
          noAnswer: 0,
          total: 0,
          contactIds: { completed: [], missed: [], noAnswer: [] },
        })
      }
      const entry = byAdvisor.get(c.assignedTo)!
      entry.total++
      if (c.status === "completed") {
        entry.completed++
        entry.contactIds.completed.push(c.contactId)
      } else if (c.status === "missed") {
        entry.missed++
        entry.contactIds.missed.push(c.contactId)
      } else if (c.status === "no-answer") {
        entry.noAnswer++
        entry.contactIds.noAnswer.push(c.contactId)
      }
    }
    const rows = [...byAdvisor.entries()]
      .map(([member, v]) => ({ member, ...v }))
      .sort((a, b) => b.total - a.total)
    const totalCalls = rows.reduce((s, r) => s + r.total, 0)
    return { rows, totalCalls }
  }, [calls])

  const visitFulfillmentData = useMemo(() => {
    const byAdvisor = new Map<string, { agendadas: number; realizadas: number }>()
    for (const a of appointments) {
      if (!a.assignedTo) continue
      if (!byAdvisor.has(a.assignedTo)) byAdvisor.set(a.assignedTo, { agendadas: 0, realizadas: 0 })
      const entry = byAdvisor.get(a.assignedTo)!
      entry.agendadas++
      if (a.status === "showed") entry.realizadas++
    }
    const rows = [...byAdvisor.entries()]
      .filter(([, v]) => v.agendadas > 0)
      .map(([member, v]) => ({
        member,
        agendadas: v.agendadas,
        realizadas: v.realizadas,
        rate: v.agendadas > 0 ? (v.realizadas / v.agendadas) * 100 : 0,
      }))
      .sort((a, b) => b.rate - a.rate)
    const totalAgendadas = rows.reduce((s, r) => s + r.agendadas, 0)
    return { rows, totalAgendadas }
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
    }).sort((a, b) => {
      const totalA = allStages.reduce((s, stage) => s + ((a[stage] as number) || 0), 0)
      const totalB = allStages.reduce((s, stage) => s + ((b[stage] as number) || 0), 0)
      return totalB - totalA
    })
  }, [members, allStages, opportunities])

  const chartConfig = useMemo(
    () => Object.fromEntries(allStages.map((stage, i) => [stage, { label: stage, color: stageColor(stage, i) }])),
    [allStages]
  )

  return (
    <DashboardShell>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <KpiCard
          variant="hero"
          label="Ingreso ganado"
          value={kpiMetrics.wonRevenue.toLocaleString("es-MX", {
            style: "currency",
            currency: "MXN",
            maximumFractionDigits: 0,
          })}
          sublabel={`${kpiMetrics.won} oportunidades ganadas`}
          icon={DollarSign}
          onClick={() =>
            openDrill(
              "Oportunidades Ganadas",
              opportunities.filter((o) => o.status === "won"),
              "Ingreso ganado total",
            )
          }
        />
        <DashboardCard interactive onClick={() => openDrill("Todas las Oportunidades", opportunities)}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Oportunidades
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                  {kpiMetrics.total.toLocaleString("es-MX")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {([
                    { key: "open",      label: "Abiertas",   color: "#335577",  count: kpiMetrics.open },
                    { key: "won",       label: "Ganadas",    color: "#F59B1B",  count: kpiMetrics.won },
                    { key: "lost",      label: "Perdidas",   color: "#ef4444",  count: kpiMetrics.lost },
                    { key: "abandoned", label: "Abandonadas",color: "#94a3b8",  count: kpiMetrics.abandoned },
                  ] as const).filter((s) => s.count > 0).map((s) => (
                    <span
                      key={s.key}
                      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: s.color + "22", color: s.color }}
                      onClick={(e) => {
                        e.stopPropagation()
                        openDrill(
                          s.label,
                          opportunities.filter((o) => o.status === s.key),
                        )
                      }}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: s.color }}
                      />
                      {s.count} {s.label}
                    </span>
                  ))}
                </div>
              </div>
              <Target className="h-5 w-5 shrink-0 text-[#335577]" aria-hidden />
            </div>
          </CardContent>
        </DashboardCard>
        <KpiCard
          label="Conversión"
          value={`${kpiMetrics.conversionRate.toFixed(1)}%`}
          sublabel={`${kpiMetrics.won} ganadas`}
          icon={TrendingUp}
          onClick={() => openDrill("Oportunidades Ganadas", opportunities.filter((o) => o.status === "won"))}
        />
        <KpiCard
          label="Miembros activos"
          value={String(kpiMetrics.activeMembers)}
          icon={Users}
          onClick={() =>
            setDrill({
              open: true,
              title: "Miembros del Equipo",
              subtitle: `${kpiMetrics.activeMembers} asesores`,
              opportunities,
              members:
                membersProp.length > 0
                  ? membersProp
                  : [...new Set(opportunities.map((o) => o.assignedTo).filter(Boolean) as string[])],
            })
          }
        />
      </div>

      <DashboardCard>
        <ChartCardHeader
          title="Leads por Miembro por Etapa del Pipeline"
          total={opportunities.length}
        />
        <ChartCardContent>
          {opportunities.length === 0 ? (
            <ChartEmpty message="Sin oportunidades para mostrar" height={192} />
          ) : (
            <>
              <ChartContainer config={chartConfig} style={{ height: 280 }} className="w-full">
                <BarChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 64 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="member" type="category" tick={{ fontSize: 11 }} interval={0} angle={-40} textAnchor="end" />
                  <YAxis type="number" tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
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
              <ChartHint>Haz clic en un segmento para ver los leads</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>


      {/* ── Rendimiento Individual ─────────────────── */}
      <SectionHeader title="Rendimiento Individual" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Chart A: Win/Loss por Asesor */}
        <DashboardCard>
          <ChartCardHeader title="Win/Loss por Asesor" total={opportunities.length} />
          <ChartCardContent>
            {winLossData.length === 0 ? (
              <ChartEmpty message="Sin oportunidades para mostrar" height={192} />
            ) : (
              <>
              <ChartContainer
                config={WIN_LOSS_CONFIG}
                style={{ height: 280 }}
                className="w-full"
              >
                <BarChart
                  data={winLossData}
                  margin={{ left: 8, right: 8, top: 24, bottom: 64 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="member"
                    type="category"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-40}
                    textAnchor="end"
                  />
                  <YAxis type="number" tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
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
                      position="top"
                      formatter={(v: unknown) =>
                        typeof v === "number" ? `${v.toFixed(1)}%` : ""
                      }
                      style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en un segmento para ver los leads</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>

        <DashboardCard>
          <ChartCardHeader title="Ingreso Ganado por Asesor" />
          <ChartCardContent>
            {revenueData.length === 0 ? (
              <ChartEmpty message="Sin ingresos ganados" height={192} />
            ) : (
              <>
              <ChartContainer
                config={{ revenue: { label: "Ingreso Ganado", color: "#F59B1B" } }}
                style={{ height: 280 }}
                className="w-full"
              >
                <BarChart
                  data={revenueData}
                  margin={{ left: 8, right: 8, top: 8, bottom: 64 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="member"
                    type="category"
                    tick={{ fontSize: 11 }}
                    interval={0}
                    angle={-40}
                    textAnchor="end"
                  />
                  <YAxis type="number" tick={{ fontSize: 11 }} />
                  <ChartTooltip
                    content={
                      <NonZeroTooltipContent
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
                  <Bar dataKey="revenue" fill="#F59B1B" radius={[4, 4, 0, 0]} cursor="pointer"
                    onClick={(data: any) => openDrill(`${data.member} · Ingreso Ganado`, opportunities.filter((o) => o.assignedTo === data.member && o.status === "won"))}
                  />
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver los leads</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>

      {responseTimeData.length > 0 && (
        <DashboardCard>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
            <CardTitle className="text-sm font-semibold leading-snug tracking-tight flex items-center">
              Tiempo promedio de respuesta del asesor
              <InfoTooltip content="Tiempo promedio que tarda un asesor en responder un mensaje entrante, calculado solo en horario laboral (lun–vie 9am–6pm). Considera únicamente la primera respuesta saliente por hilo de conversación." />
            </CardTitle>
            <TotalBadge value={`${responseTimeData.length} asesores`} />
          </CardHeader>
          <ChartCardContent>
            <ChartContainer
              config={{ avgMinutes: { label: "Tiempo de respuesta", color: "#F59B1B" } }}
              style={{ height: 280 }}
              className="w-full"
            >
              <BarChart
                data={responseTimeData}
                margin={{ left: 8, right: 8, top: 24, bottom: 64 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="member"
                  type="category"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-40}
                  textAnchor="end"
                />
                <YAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${Math.round(v as number)}m`}
                />
                <ChartTooltip
                  content={
                    <NonZeroTooltipContent
                      formatter={(value) =>
                        typeof value === "number" ? formatMinutes(value) : String(value)
                      }
                    />
                  }
                />
                <Bar dataKey="avgMinutes" radius={[3, 3, 0, 0]}>
                  {responseTimeData.map((entry) => (
                    <Cell key={entry.member} fill={responseColor(entry.avgMinutes)} />
                  ))}
                  <LabelList
                    dataKey="avgMinutes"
                    position="top"
                    formatter={(v: unknown) =>
                      typeof v === "number" ? formatMinutes(v) : ""
                    }
                    style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </ChartCardContent>
        </DashboardCard>
      )}

      {/* ── Salud del Pipeline ─────────────────────── */}
      <SectionHeader title="Salud del Pipeline" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Chart C: Valor en Pipeline por Etapa */}
        <DashboardCard>
          <ChartCardHeader title="Valor en Pipeline por Etapa" />
          <ChartCardContent>
            {pipelineValueData.length === 0 ? (
              <ChartEmpty message="Sin oportunidades abiertas" height={192} />
            ) : (
              <>
              <ChartContainer
                config={{ value: { label: "Valor en Pipeline", color: STRUCTURAL_NAVY } }}
                style={{ height: 280 }}
                className="w-full"
              >
                <BarChart
                  data={pipelineValueData}
                  margin={{ left: 8, right: 16, top: 8, bottom: 64 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="stage"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-40}
                    textAnchor="end"
                    tickFormatter={(v: string) => v.length > 16 ? v.slice(0, 16) + "…" : v}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) =>
                      v >= 1_000_000
                        ? `$${(v / 1_000_000).toFixed(1)}M`
                        : v >= 1_000
                        ? `$${(v / 1_000).toFixed(0)}k`
                        : `$${v}`
                    }
                  />
                  <ChartTooltip
                    content={
                      <NonZeroTooltipContent
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
                  <Bar dataKey="value" fill={STRUCTURAL_NAVY} radius={[4, 4, 0, 0]} cursor="pointer"
                    onClick={(data: any) => openDrill(`Pipeline: ${data.stage}`, opportunities.filter((o) => o.status === "open" && o.stage === data.stage))}
                  />
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver los leads</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>

        <DashboardCard>
          <ChartCardHeader title="Nuevas Oportunidades por Período" total={opportunities.length} />
          <ChartCardContent>
            {trendData.length === 0 ? (
              <ChartEmpty message="Sin datos de tendencia" height={192} />
            ) : (
              <>
              <ChartContainer
                config={{ count: { label: "Nuevas Oportunidades", color: BRAND_AMBER } }}
                style={{ height: 220 }}
                className="w-full"
              >
                <BarChart
                  data={trendData}
                  margin={{ left: 8, right: 8, top: 8, bottom: 48 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11 }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Bar dataKey="count" fill={BRAND_AMBER} radius={[3, 3, 0, 0]} cursor="pointer"
                    onClick={(data: any) => openDrill(`Período: ${data.period}`, data.opps ?? [])}
                  />
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver los leads</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>

      <SectionHeader title="Actividad de Conversaciones" />
      <DashboardCard>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-semibold leading-snug tracking-tight flex items-center">
            Conversaciones únicas por día
            <InfoTooltip content="Cuenta hilos de conversación distintos que tuvieron al menos un mensaje ese día, sin importar el canal ni la hora." />
          </CardTitle>
          {messagesLoading && messages.length === 0 ? (
            <span className="text-xs text-muted-foreground">Cargando conversaciones…</span>
          ) : (
            <TotalBadge value={new Set(messages.map((m) => m.conversationId).filter(Boolean)).size} />
          )}
        </CardHeader>
        <ChartCardContent>
          {dailyConvData.length === 0 ? (
            <ChartEmpty message="Sin datos de conversaciones" height={192} />
          ) : (
            <>
              <ChartContainer
                config={{ count: { label: "Conversaciones", color: STRUCTURAL_NAVY } }}
                style={{ height: 220 }}
                className="w-full"
              >
                <BarChart
                  data={dailyConvData}
                  margin={{ left: 8, right: 8, top: 8, bottom: dailyConvData.length > 10 ? 48 : 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    angle={dailyConvData.length > 10 ? -35 : 0}
                    textAnchor={dailyConvData.length > 10 ? "end" : "middle"}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Bar
                    dataKey="count"
                    fill={STRUCTURAL_NAVY}
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    onClick={(data: any) =>
                      openDrillContacts(`Conversaciones del ${data.label}`, data.contactIds ?? [])
                    }
                  />
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver los contactos</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <DashboardCard>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-semibold leading-snug tracking-tight flex items-center">
            Conversaciones únicas por asesor
            <InfoTooltip content="Número de conversaciones únicas atendidas por cada asesor, agrupadas por el mes del primer mensaje del hilo." />
          </CardTitle>
          <TotalBadge value={convByAdvisorMonthData.totalConvs} />
        </CardHeader>
        <ChartCardContent>
          {convByAdvisorMonthData.data.length === 0 ? (
            <ChartEmpty message="Sin datos de conversaciones" height={192} />
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  convByAdvisorMonthData.advisors.map((advisor, i) => [
                    advisor,
                    { label: advisor, color: CHART_PALETTE[i % CHART_PALETTE.length] },
                  ])
                )}
                style={{ height: 320 }}
                className="w-full"
              >
                <BarChart
                  data={convByAdvisorMonthData.data}
                  margin={{ left: 8, right: 8, top: 16, bottom: 32 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 28 }} />
                  {convByAdvisorMonthData.advisors.map((advisor, i) => (
                    <Bar
                      key={advisor}
                      dataKey={advisor}
                      stackId="conv"
                      fill={CHART_PALETTE[i % CHART_PALETTE.length]}
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
              <ChartHint>Haz clic en un segmento para ver los contactos</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <SectionHeader title="Citas" />
      <DashboardCard>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-semibold leading-snug tracking-tight flex items-center">
            Citas por mes por asesor
            <InfoTooltip content="Citas (calendar events) agrupadas por mes. Cada mes muestra una barra por asesor, desglosada por estatus. Ventana fija: últimos 90 días." />
          </CardTitle>
          <TotalBadge value={apptByMonthByAdvisor.total} />
        </CardHeader>
        <ChartCardContent>
          {apptByMonthByAdvisor.data.length === 0 ? (
            <ChartEmpty message="Sin citas para mostrar" height={192} />
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
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend
                    content={() => (
                      <div className="flex flex-wrap gap-3 justify-center pt-7">
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
              <ChartHint>Haz clic en un segmento para ver las citas</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <SectionHeader title="Responsabilidad del Asesor" />

      <DashboardCard>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-semibold leading-snug tracking-tight flex items-center">
            Campos vacíos por asesor
            <InfoTooltip content="Promedio de campos vacíos por oportunidad. Mide qué tan completamente cada asesor llena los datos de sus oportunidades. Considera campos estándar (valor, fuente, notas, tags, prioridad) y todos los custom fields presentes en el dataset." />
          </CardTitle>
          <TotalBadge value={emptyFieldsData.rows.reduce((s, r) => s + r.totalOpps, 0)} />
        </CardHeader>
        <ChartCardContent>
          {emptyFieldsData.rows.length === 0 ? (
            <ChartEmpty message="Sin oportunidades para mostrar" height={192} />
          ) : (
            <>
              <ChartContainer
                config={{
                  avgStandard: { label: "Estándar vacíos", color: STRUCTURAL_NAVY },
                  avgCustom: { label: "Custom vacíos", color: BRAND_AMBER },
                }}
                style={{ height: 280 }}
                className="w-full"
              >
                <BarChart
                  data={emptyFieldsData.rows}
                  margin={{ left: 8, right: 16, top: 8, bottom: 64 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="member"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-40}
                    textAnchor="end"
                    tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + "…" : v}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <ChartTooltip
                    content={
                      <NonZeroTooltipContent
                        formatter={(value) =>
                          typeof value === "number" ? value.toFixed(1) : String(value)
                        }
                      />
                    }
                  />
                  <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
                  <Bar
                    dataKey="avgStandard"
                    stackId="empty"
                    fill={STRUCTURAL_NAVY}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = emptyFieldsData.rows.find((r) => r.member === data.member)
                      if (!row) return
                      const sorted = [...row.opps].sort(
                        (a, b) => (row.perOpp.get(b.id) ?? 0) - (row.perOpp.get(a.id) ?? 0)
                      )
                      openDrill(`${row.member} · Oportunidades con campos vacíos`, sorted)
                    }}
                  />
                  <Bar
                    dataKey="avgCustom"
                    stackId="empty"
                    fill={BRAND_AMBER}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = emptyFieldsData.rows.find((r) => r.member === data.member)
                      if (!row) return
                      const sorted = [...row.opps].sort(
                        (a, b) => (row.perOpp.get(b.id) ?? 0) - (row.perOpp.get(a.id) ?? 0)
                      )
                      openDrill(`${row.member} · Oportunidades con campos vacíos`, sorted)
                    }}
                  >
                    <LabelList
                      dataKey="avgTotal"
                      position="top"
                      formatter={(v: unknown) =>
                        typeof v === "number" ? `${v.toFixed(1)}` : ""
                      }
                      style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver las oportunidades</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <DashboardCard>
        <ChartCardHeader title="Llamadas por asesor" total={callsByAdvisorData.totalCalls} />
        <ChartCardContent>
          {callsByAdvisorData.rows.length === 0 ? (
            <ChartEmpty message="Sin llamadas registradas" height={192} />
          ) : (
            <>
              <ChartContainer
                config={{
                  completed: { label: "Completadas", color: "#10b981" },
                  missed: { label: "Perdidas", color: "#ef4444" },
                  noAnswer: { label: "Sin respuesta", color: "#94a3b8" },
                }}
                style={{ height: 280 }}
                className="w-full"
              >
                <BarChart
                  data={callsByAdvisorData.rows}
                  margin={{ left: 8, right: 16, top: 8, bottom: 64 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="member"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-40}
                    textAnchor="end"
                    tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + "…" : v}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
                  <Bar
                    dataKey="completed"
                    stackId="calls"
                    fill="#10b981"
                    cursor="pointer"
                    onClick={(data: any) =>
                      openDrillContacts(`${data.member} · Completadas`, data.contactIds?.completed ?? [])
                    }
                  />
                  <Bar
                    dataKey="missed"
                    stackId="calls"
                    fill="#ef4444"
                    cursor="pointer"
                    onClick={(data: any) =>
                      openDrillContacts(`${data.member} · Perdidas`, data.contactIds?.missed ?? [])
                    }
                  />
                  <Bar
                    dataKey="noAnswer"
                    stackId="calls"
                    fill="#94a3b8"
                    cursor="pointer"
                    onClick={(data: any) =>
                      openDrillContacts(`${data.member} · Sin respuesta`, data.contactIds?.noAnswer ?? [])
                    }
                  >
                    <LabelList
                      dataKey="total"
                      position="top"
                      formatter={(v: unknown) => (typeof v === "number" ? String(v) : "")}
                      style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en un segmento para ver los contactos</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <DashboardCard>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-semibold leading-snug tracking-tight flex items-center">
            Visitas agendadas vs realizadas
            <InfoTooltip content="Compara visitas agendadas (todas las citas, sin importar estatus) contra realizadas (estatus = 'showed'). La etiqueta muestra la tasa de cumplimiento del asesor." />
          </CardTitle>
          <TotalBadge value={visitFulfillmentData.totalAgendadas} />
        </CardHeader>
        <ChartCardContent>
          {visitFulfillmentData.rows.length === 0 ? (
            <ChartEmpty message="Sin visitas para mostrar" height={192} />
          ) : (
            <>
              <ChartContainer
                config={{
                  agendadas: { label: "Agendadas", color: STRUCTURAL_NAVY },
                  realizadas: { label: "Realizadas", color: BRAND_AMBER },
                }}
                style={{ height: 280 }}
                className="w-full"
              >
                <BarChart
                  data={visitFulfillmentData.rows}
                  margin={{ left: 8, right: 16, top: 8, bottom: 64 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="member"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    angle={-40}
                    textAnchor="end"
                    tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + "…" : v}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
                  <Bar
                    dataKey="agendadas"
                    fill={STRUCTURAL_NAVY}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const matched = appointments.filter((a) => a.assignedTo === data.member)
                      setApptDrill({
                        open: true,
                        title: `${data.member} · Visitas agendadas`,
                        appointments: matched,
                      })
                    }}
                  />
                  <Bar
                    dataKey="realizadas"
                    fill={BRAND_AMBER}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const matched = appointments.filter(
                        (a) => a.assignedTo === data.member && a.status === "showed"
                      )
                      setApptDrill({
                        open: true,
                        title: `${data.member} · Visitas realizadas`,
                        appointments: matched,
                      })
                    }}
                  >
                    <LabelList
                      dataKey="rate"
                      position="top"
                      formatter={(v: unknown) =>
                        typeof v === "number" ? `${v.toFixed(0)}%` : ""
                      }
                      style={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver las citas</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <SectionHeader title="Análisis de Pérdidas" />
      <DashboardCard>
        <ChartCardHeader
          title="Razones de Pérdida por Asesor"
          total={opportunities.filter((o) => o.status === "lost").length}
        />
        <ChartCardContent>
          {lostReasonsData.data.length === 0 ? (
            <ChartEmpty message="Sin oportunidades perdidas" height={192} />
          ) : (
            <>
            <ChartContainer
              config={lostReasonsConfig}
              style={{ height: 280 }}
              className="w-full"
            >
              <BarChart
                data={lostReasonsData.data}
                margin={{ left: 8, right: 16, top: 8, bottom: 64 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="member"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-40}
                  textAnchor="end"
                  tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + "…" : v}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <ChartTooltip content={<NonZeroTooltipContent />} />
                <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
                {lostReasonsData.reasons.map((reason, i) => (
                  <Bar
                    key={reason}
                    dataKey={reason}
                    stackId="a"
                    fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                    cursor="pointer"
                    onClick={(data: any) => openDrill(
                      `${data.member} · ${reason}`,
                      opportunities.filter((o) => o.assignedTo === data.member && o.status === "lost" && (o.lostReason ?? "Sin razón") === reason)
                    )}
                  />
                ))}
              </BarChart>
            </ChartContainer>
              <ChartHint>Haz clic en un segmento para ver los leads</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

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
        allPautas={pautas}
        appointments={appointments}
        messages={messages}
        locationId={locationId}
        onAnalyzeWithAI={onAnalyzeWithAI}
      />
    </DashboardShell>
  )
}
