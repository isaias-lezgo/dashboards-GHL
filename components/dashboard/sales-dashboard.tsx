"use client"

import { useState, useCallback, useMemo } from "react"
import {
  Bar,
  BarChart,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Cell,
} from "recharts"
import { CardContent } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import type { Opportunity, Contact, Call, Message, Task, Appointment, Pauta, Pipeline } from "@/lib/types"
import { Users, TrendingUp, Target, DollarSign, CalendarDays } from "lucide-react"
import { PLATFORM_COLORS, PLATFORM_ORDER, platformLabel } from "@/lib/source-platform"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"
import {
  BRAND_AMBER,
  STRUCTURAL_NAVY,
  CHART_GRID_STROKE,
  chartPaletteColor,
  DashboardShell,
  DashboardCard,
  ChartCardHeader,
  ChartCardContent,
  ChartEmpty,
  ChartHint,
  KpiCard,
  SectionHeader,
  NonZeroTooltipContent,
  PlatformIcon,
} from "./dashboard-ui"
import {
  AppointmentDrillDrawer,
  APPT_DRILL_CLOSED,
  type ApptDrillState,
} from "./appointment-drill-drawer"
import { ExportReportButton } from "./export-report-button"
import type { ReportInput, ReportSection } from "@/lib/report"

interface SalesDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  /**
   * Full, date-unfiltered contact set, used only as a lookup table when a
   * drill-down/detail drawer resolves an opportunity's linked contact. A
   * contact can be created before its opportunity, so the date filter may drop
   * it from `contacts` even while the opportunity is in range — resolving the
   * join against the filtered slice would then show "Contacto no encontrado".
   * Charts/KPIs still use the date-filtered `contacts`. Defaults to `contacts`.
   */
  allContacts?: Contact[]
  calls: Call[]
  messages: Message[]
  appointments: Appointment[]
  pipelines?: Pipeline[]
  tasks?: Task[]
  pautas?: Pauta[]
  members?: string[]
  locationId?: string
  /** Sub-account name, used in the exported report's filename. */
  locationName?: string
  /** Label of the active global date filter, shown on the PDF report cover. */
  periodLabel?: string
}

// Funnel milestone palette — entry blue → progress teal/green → won amber.
const FUNNEL_STAGE_COLORS = ["#3b82f6", "#8b5cf6", "#14b8a6", "#22c55e", BRAND_AMBER]

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

// Timeline (Línea de tiempo) — amber for contactos, emerald for oportunidades.
type TimelineGran = "day" | "week" | "month"
const TIMELINE_CONTACTS_COLOR = "#f59e0b"
const TIMELINE_OPPS_COLOR = "#10b981"

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// Monday-anchored start of week (local time).
function startOfWeek(input: Date): Date {
  const d = new Date(input)
  d.setHours(0, 0, 0, 0)
  const offset = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  d.setDate(d.getDate() - offset)
  return d
}

export function SalesDashboard({ opportunities, contacts, allContacts, calls, messages = [], appointments = [], pipelines = [], tasks = [], pautas = [], members: membersProp = [], locationId = "", locationName, periodLabel }: SalesDashboardProps) {
  // Lookup table for drawer contact-resolution: the full set when provided,
  // falling back to the date-filtered `contacts` for backward compatibility.
  const lookupContacts = allContacts ?? contacts
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const [apptDrill, setApptDrill] = useState<ApptDrillState>(APPT_DRILL_CLOSED)
  const [matrixBy, setMatrixBy] = useState<"asesor" | "origen">("asesor")
  const [hoveredOrigin, setHoveredOrigin] = useState<number | undefined>(undefined)
  const [timelineGran, setTimelineGran] = useState<TimelineGran>("month")

  const openDrill = useCallback((title: string, items: Opportunity[], subtitle?: string) => {
    setDrill({ open: true, title, subtitle, opportunities: items })
  }, [])

  const openContactsDrill = useCallback((title: string, items: Contact[], subtitle?: string) => {
    setDrill({ open: true, title, subtitle, opportunities: [], contactItems: items })
  }, [])

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
    const contactsTotal = contacts.length
    const oppCountByContact = new Map<string, number>()
    for (const o of opportunities) {
      if (o.contactId) oppCountByContact.set(o.contactId, (oppCountByContact.get(o.contactId) ?? 0) + 1)
    }
    const contactIdsInList = new Set(contacts.map((c) => c.id))
    const contactsWithOpportunity = contacts.filter((c) => (oppCountByContact.get(c.id) ?? 0) >= 1).length
    const contactsWithoutOpportunity = contactsTotal - contactsWithOpportunity
    const contactsWithMultipleOpportunities = contacts.filter((c) => (oppCountByContact.get(c.id) ?? 0) > 1).length
    const contactsWithoutOpp = contacts.filter((c) => (oppCountByContact.get(c.id) ?? 0) === 0)
    const oppsWithContact = opportunities.filter((o) => o.contactId && contactIdsInList.has(o.contactId))
    const oppsMultiContact = opportunities.filter((o) => o.contactId && (oppCountByContact.get(o.contactId) ?? 0) > 1)
    return { total, won, open, lost, abandoned, wonRevenue, activeMembers, conversionRate, contactsTotal, contactsWithOpportunity, contactsWithoutOpportunity, contactsWithMultipleOpportunities, contactsWithoutOpp, oppsWithContact, oppsMultiContact }
  }, [opportunities, contacts, membersProp])

  // ── Embudo: hitos del recorrido del lead (lead → contacto → cita → realizada → ganado) ──
  const funnelData = useMemo(() => {
    const contactedIds = new Set<string>()
    for (const m of messages) if (m.contactId) contactedIds.add(m.contactId)
    for (const c of calls) if (c.contactId) contactedIds.add(c.contactId)
    const apptIds = new Set(appointments.map((a) => a.contactId))
    const showedIds = new Set(
      appointments.filter((a) => a.status === "showed").map((a) => a.contactId)
    )

    const conCita = opportunities.filter((o) => apptIds.has(o.contactId))
    const contactados = opportunities.filter((o) => contactedIds.has(o.contactId))
    const realizadas = opportunities.filter((o) => showedIds.has(o.contactId))
    const ganados = opportunities.filter((o) => o.status === "won")

    // Core milestones come from robust data (creation, appointments, status).
    // The optional ones (conversations coverage, "showed" status hygiene) often
    // undercount in GHL; include them only when they keep the funnel descending,
    // otherwise the step conversions read as nonsense (>100%).
    const stages: Array<{ key: string; label: string; opps: Opportunity[] }> = [
      { key: "leads", label: "Oportunidades recibidas", opps: opportunities },
      ...(contactedIds.size > 0 && contactados.length >= conCita.length
        ? [{ key: "contacted", label: "Contactados", opps: contactados }]
        : []),
      { key: "appt", label: "Con cita agendada", opps: conCita },
      ...(realizadas.length >= ganados.length && realizadas.length <= conCita.length
        ? [{ key: "showed", label: "Cita realizada", opps: realizadas }]
        : []),
      { key: "won", label: "Ganados", opps: ganados },
    ]
    return stages.map((s, i) => ({
      ...s,
      count: s.opps.length,
      color: s.key === "won" ? BRAND_AMBER : FUNNEL_STAGE_COLORS[i % FUNNEL_STAGE_COLORS.length],
    }))
  }, [opportunities, messages, calls, appointments])

  // ── Histórico mensual (cohorte: sigue a los leads creados en cada mes) ──
  const monthlyFunnel = useMemo(() => {
    const apptContactIds = new Set(appointments.map((a) => a.contactId))
    const byMonth = new Map<string, { leads: Opportunity[]; appts: Appointment[] }>()
    const ensure = (key: string) => {
      if (!byMonth.has(key)) byMonth.set(key, { leads: [], appts: [] })
      return byMonth.get(key)!
    }
    for (const o of opportunities) {
      const key = (o.createdAt ?? "").slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(key)) continue
      ensure(key).leads.push(o)
    }
    for (const a of appointments) {
      const key = (a.startTime ?? "").slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(key)) continue
      ensure(key).appts.push(a)
    }
    // Months that only have appointments (e.g. future citas) would render as
    // all-zero lead columns — keep only months where leads were created.
    const keys = [...byMonth.keys()]
      .filter((k) => (byMonth.get(k)?.leads.length ?? 0) > 0)
      .sort()
      .slice(-6)
    const months = keys.map((key) => {
      const [y, m] = key.split("-").map(Number)
      const e = byMonth.get(key)!
      const conCita = e.leads.filter((o) => apptContactIds.has(o.contactId))
      const ganados = e.leads.filter((o) => o.status === "won")
      return {
        key,
        label: new Date(y, m - 1, 1).toLocaleDateString("es-MX", { month: "short", year: "2-digit" }),
        leads: e.leads,
        appts: e.appts,
        conCita,
        ganados,
        citaRate: e.leads.length > 0 ? (conCita.length / e.leads.length) * 100 : 0,
        cierreRate: e.leads.length > 0 ? (ganados.length / e.leads.length) * 100 : 0,
      }
    })
    const chartData = months.map((m) => ({
      key: m.key,
      label: m.label,
      leads: m.leads.length,
      rate: Math.round(m.citaRate * 10) / 10,
    }))
    return { months, chartData }
  }, [opportunities, appointments])

  // ── Línea de tiempo: contactos y oportunidades creados (X = día/semana/mes) ──
  // Granularity only changes the X-axis bucketing; the top filter governs the dataset.
  const timelineData = useMemo(() => {
    type Bucket = { key: string; label: string; sort: number; contacts: Contact[]; opps: Opportunity[] }
    const buckets = new Map<string, Bucket>()
    const ensure = (d: Date): Bucket => {
      let anchor: Date
      let key: string
      let label: string
      if (timelineGran === "day") {
        anchor = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        key = ymd(anchor)
        label = anchor.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
      } else if (timelineGran === "week") {
        anchor = startOfWeek(d)
        key = ymd(anchor)
        label = anchor.toLocaleDateString("es-MX", { day: "numeric", month: "short" })
      } else {
        anchor = new Date(d.getFullYear(), d.getMonth(), 1)
        key = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`
        label = anchor.toLocaleDateString("es-MX", { month: "short", year: "2-digit" })
      }
      let b = buckets.get(key)
      if (!b) {
        b = { key, label, sort: anchor.getTime(), contacts: [], opps: [] }
        buckets.set(key, b)
      }
      return b
    }
    for (const c of contacts) {
      const d = new Date(c.createdAt)
      if (isNaN(d.getTime())) continue
      ensure(d).contacts.push(c)
    }
    for (const o of opportunities) {
      const d = new Date(o.createdAt)
      if (isNaN(d.getTime())) continue
      ensure(d).opps.push(o)
    }
    const sorted = [...buckets.values()].sort((a, b) => a.sort - b.sort)
    const chartData = sorted.map((b) => ({
      key: b.key,
      label: b.label,
      contacts: b.contacts.length,
      opps: b.opps.length,
    }))
    return { buckets: sorted, chartData }
  }, [contacts, opportunities, timelineGran])

  // ── Origen de leads (plataforma normalizada) con conversión a cita ──
  const origenData = useMemo(() => {
    const apptIds = new Set(appointments.map((a) => a.contactId))
    const byPlatform = new Map<string, Opportunity[]>()
    for (const o of opportunities) {
      const p = platformLabel(o)
      if (!byPlatform.has(p)) byPlatform.set(p, [])
      byPlatform.get(p)!.push(o)
    }
    const total = opportunities.length
    return PLATFORM_ORDER.filter((p) => byPlatform.has(p)).map((platform) => {
      const opps = byPlatform.get(platform)!
      const citas = opps.filter((o) => apptIds.has(o.contactId))
      return {
        platform,
        opps,
        citas,
        count: opps.length,
        pct: total > 0 ? (opps.length / total) * 100 : 0,
        citaRate: opps.length > 0 ? (citas.length / opps.length) * 100 : 0,
        color: PLATFORM_COLORS[platform] ?? "#6b7280",
      }
    }).sort((a, b) => b.count - a.count)
  }, [opportunities, appointments])

  // ── Resultado de las citas (barra segmentada por estatus) ──
  const apptOutcomeData = useMemo(() => {
    const byStatus = new Map<string, Appointment[]>()
    for (const a of appointments) {
      if (!byStatus.has(a.status)) byStatus.set(a.status, [])
      byStatus.get(a.status)!.push(a)
    }
    const statuses = [...byStatus.keys()].sort((a, b) => {
      const ai = KNOWN_APPT_STATUS_ORDER.indexOf(a)
      const bi = KNOWN_APPT_STATUS_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return statuses.map((status, i) => {
      const appts = byStatus.get(status)!
      return {
        status,
        appts,
        count: appts.length,
        pct: appointments.length > 0 ? (appts.length / appointments.length) * 100 : 0,
        ...apptStatusVisual(status, i),
      }
    })
  }, [appointments])

  // ── Razones de pérdida agrupadas (top 5 + resto) ──
  const lossGroupsData = useMemo(() => {
    const lost = opportunities.filter((o) => o.status === "lost")
    const byReason = new Map<string, Opportunity[]>()
    for (const o of lost) {
      const reason = o.lostReason ?? "Sin razón"
      if (!byReason.has(reason)) byReason.set(reason, [])
      byReason.get(reason)!.push(o)
    }
    const sorted = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)
    const top = sorted.slice(0, 5)
    const rest = sorted.slice(5)
    const groups = top.map(([reason, opps], i) => ({
      reason,
      opps,
      count: opps.length,
      pct: lost.length > 0 ? (opps.length / lost.length) * 100 : 0,
      color: chartPaletteColor(i),
    }))
    if (rest.length > 0) {
      const opps = rest.flatMap(([, o]) => o)
      groups.push({
        reason: `Otras ${rest.length} razones`,
        opps,
        count: opps.length,
        pct: lost.length > 0 ? (opps.length / lost.length) * 100 : 0,
        color: "#6b7280",
      })
    }
    return { groups, totalLost: lost.length }
  }, [opportunities])

  // ── Matriz etapa × (asesor | origen) con intensidad por volumen ──
  const pipelineMatrix = useMemo(() => {
    if (opportunities.length === 0) return null
    const stageOrder: string[] = []
    for (const p of pipelines) for (const s of p.stages) if (!stageOrder.includes(s)) stageOrder.push(s)
    const openOpps = opportunities.filter((o) => o.status === "open")
    const openStages = [...new Set(openOpps.map((o) => o.stage))].sort((a, b) => {
      const ai = stageOrder.indexOf(a)
      const bi = stageOrder.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    type MatrixRow = { label: string; dot: string; kind: "open" | "won" | "abandoned" | "lost"; opps: Opportunity[] }
    const rows: MatrixRow[] = openStages.map((s) => ({
      label: s,
      dot: "#3b82f6",
      kind: "open" as const,
      opps: openOpps.filter((o) => o.stage === s),
    }))
    const statusRows: Array<[Opportunity["status"], string, string, MatrixRow["kind"]]> = [
      ["won", "Ganado", BRAND_AMBER, "won"],
      ["abandoned", "Abandonado", "#94a3b8", "abandoned"],
      ["lost", "Perdido", "#ef4444", "lost"],
    ]
    for (const [status, label, dot, kind] of statusRows) {
      const opps = opportunities.filter((o) => o.status === status)
      if (opps.length > 0) rows.push({ label, dot, kind, opps })
    }
    const colOf = matrixBy === "origen"
      ? platformLabel
      : (o: Opportunity) => o.assignedTo || "Sin asesor"
    const colTotals = new Map<string, number>()
    for (const o of opportunities) colTotals.set(colOf(o), (colTotals.get(colOf(o)) ?? 0) + 1)
    const cols = matrixBy === "origen"
      ? PLATFORM_ORDER.filter((p) => colTotals.has(p))
      : [...colTotals.keys()].sort((a, b) => (colTotals.get(b) ?? 0) - (colTotals.get(a) ?? 0))
    const cells = rows.map((r) => cols.map((c) => r.opps.filter((o) => colOf(o) === c)))
    let liveMax = 1
    let lostMax = 1
    rows.forEach((r, i) => {
      for (const cellOpps of cells[i]) {
        if (r.kind === "lost") lostMax = Math.max(lostMax, cellOpps.length)
        else liveMax = Math.max(liveMax, cellOpps.length)
      }
    })
    return { rows, cols, cells, colTotals, liveMax, lostMax, total: opportunities.length }
  }, [opportunities, pipelines, matrixBy])

  // PDF report spec from the same memos the charts render (computed on click).
  const buildReport = useCallback((): ReportInput => {
    const mxn = (v: number) =>
      v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })
    const sections: ReportSection[] = []

    if (funnelData.length > 0) {
      sections.push({
        id: "funnel",
        title: "Recorrido de la oportunidad",
        explanation:
          "El embudo de ventas por hitos: oportunidades recibidas, contactadas, con cita agendada y ganadas. Cada paso muestra cuántas oportunidades sobreviven a esa etapa del recorrido.",
        ai: true,
        blocks: [{
          t: "chart", type: "bar", orientation: "h", valueLabel: "Oportunidades",
          title: `Embudo (total: ${kpiMetrics.total})`,
          series: funnelData.map((s) => ({ label: s.label, value: s.count })),
        }],
      })
    }

    if (monthlyFunnel.months.length > 0) {
      sections.push({
        id: "historico",
        title: "Histórico de oportunidades y conversión a cita",
        explanation:
          "Cohorte mensual: cuántas oportunidades se crearon cada mes y qué porcentaje de ellas llegó a agendar cita y a cerrarse. Permite ver si el volumen y la calidad mejoran o empeoran con el tiempo.",
        ai: true,
        blocks: [
          {
            t: "chart", type: "line", valueLabel: "Oportunidades",
            title: "Oportunidades creadas por mes",
            series: monthlyFunnel.chartData.map((m) => ({ label: m.label, value: m.leads })),
          },
          {
            t: "table",
            headers: ["Mes", "Oportunidades", "Con cita", "% a cita", "Ganados", "% cierre"],
            rows: monthlyFunnel.months.map((m) => [
              m.label,
              String(m.leads.length),
              String(m.conCita.length),
              `${m.citaRate.toFixed(1)}%`,
              String(m.ganados.length),
              `${m.cierreRate.toFixed(1)}%`,
            ]),
          },
        ],
      })
    }

    if (origenData.length > 0) {
      sections.push({
        id: "origen",
        title: "Origen de oportunidades y conversión a cita",
        explanation:
          "De qué plataforma proviene cada oportunidad y qué porcentaje de cada origen llega a agendar una cita. Compara el volumen contra la calidad de cada canal.",
        ai: true,
        blocks: [{
          t: "table",
          headers: ["Plataforma", "Oportunidades", "% del total", "% a cita"],
          rows: origenData.map((o) => [
            o.platform,
            String(o.count),
            `${o.pct.toFixed(1)}%`,
            `${o.citaRate.toFixed(1)}%`,
          ]),
        }],
      })
    }

    if (pipelineMatrix && pipelineMatrix.rows.length > 0) {
      sections.push({
        id: "etapas",
        title: "Estado actual del embudo por etapa",
        explanation:
          "Cuántas oportunidades hay hoy en cada etapa del pipeline (las abiertas) y cuántas terminaron ganadas, abandonadas o perdidas. Es la fotografía actual de la cartera.",
        blocks: [{
          t: "table",
          headers: ["Etapa / Estado", "Oportunidades"],
          rows: pipelineMatrix.rows.map((r) => [r.label, String(r.opps.length)]),
        }],
      })
    }

    if (apptOutcomeData.length > 0) {
      sections.push({
        id: "citas",
        title: "Resultado de las citas",
        explanation:
          "Distribución de las citas agendadas según su estatus final: asistió, confirmada, pendiente, no asistió o cancelada. Mide la efectividad del agendamiento.",
        blocks: [{
          t: "chart", type: "pie", valueLabel: "Citas",
          title: `Citas (total: ${appointments.length})`,
          series: apptOutcomeData.map((s) => ({ label: s.label, value: s.count })),
        }],
      })
    }

    if (lossGroupsData.groups.length > 0) {
      sections.push({
        id: "perdidas",
        title: "Principales razones de pérdida",
        explanation:
          "Las razones más frecuentes por las que se pierden oportunidades. Concentra los esfuerzos de mejora donde más ventas se están cayendo.",
        ai: true,
        blocks: [{
          t: "chart", type: "bar", orientation: "h", valueLabel: "Oportunidades",
          title: `Perdidas (total: ${lossGroupsData.totalLost})`,
          series: lossGroupsData.groups.map((g) => ({ label: g.reason, value: g.count })),
        }],
      })
    }

    return {
      reportType: "ventas",
      title: "Reporte de Ventas",
      locationName,
      periodLabel,
      kpis: [
        { label: "Ingreso ganado", value: mxn(kpiMetrics.wonRevenue) },
        { label: "Oportunidades", value: String(kpiMetrics.total) },
        { label: "Ganadas", value: String(kpiMetrics.won) },
        { label: "Conversión", value: `${kpiMetrics.conversionRate.toFixed(1)}%` },
        { label: "Citas", value: String(appointments.length) },
        { label: "Miembros activos", value: String(kpiMetrics.activeMembers) },
      ],
      sections,
    }
  }, [
    funnelData, monthlyFunnel, origenData, pipelineMatrix, apptOutcomeData,
    lossGroupsData, kpiMetrics, appointments.length, periodLabel, locationName,
  ])

  return (
    <DashboardShell>
      <div className="flex justify-end">
        <ExportReportButton getInput={buildReport} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
        {/* Contactos */}
        <DashboardCard interactive onClick={() => openDrill("Todos los Contactos", kpiMetrics.oppsWithContact)}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Contactos
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">
                  {kpiMetrics.contactsTotal.toLocaleString("es-MX")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {kpiMetrics.contactsWithOpportunity > 0 && (
                    <span
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-75"
                      style={{ background: "#0284c722", color: "#0284c7" }}
                      onClick={(e) => {
                        e.stopPropagation()
                        openDrill("Contactos con oportunidad", kpiMetrics.oppsWithContact)
                      }}
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#0284c7" }} />
                      {kpiMetrics.contactsWithOpportunity} Con oportunidad
                    </span>
                  )}
                  {kpiMetrics.contactsWithoutOpportunity > 0 && (
                    <span
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-75"
                      style={{ background: "#94a3b822", color: "#94a3b8" }}
                      onClick={(e) => {
                        e.stopPropagation()
                        openContactsDrill("Contactos sin oportunidad", kpiMetrics.contactsWithoutOpp)
                      }}
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#94a3b8" }} />
                      {kpiMetrics.contactsWithoutOpportunity} Sin oportunidad
                    </span>
                  )}
                  {kpiMetrics.contactsWithMultipleOpportunities > 0 && (
                    <span
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-75"
                      style={{ background: "#8b5cf622", color: "#8b5cf6" }}
                      onClick={(e) => {
                        e.stopPropagation()
                        openDrill("Contactos con más de una oportunidad", kpiMetrics.oppsMultiContact)
                      }}
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#8b5cf6" }} />
                      {kpiMetrics.contactsWithMultipleOpportunities} Más de una oportunidad
                    </span>
                  )}
                </div>
              </div>
              <Users className="h-5 w-5 shrink-0 text-[#0284c7]" aria-hidden />
            </div>
          </CardContent>
        </DashboardCard>

        {/* Oportunidades */}
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
                    { key: "open",      label: "Abiertas",    color: "#7c3aed", count: kpiMetrics.open },
                    { key: "won",       label: "Ganadas",     color: "#F59B1B", count: kpiMetrics.won },
                    { key: "lost",      label: "Perdidas",    color: "#ef4444", count: kpiMetrics.lost },
                    { key: "abandoned", label: "Abandonadas", color: "#94a3b8", count: kpiMetrics.abandoned },
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
              <Target className="h-5 w-5 shrink-0 text-[#7c3aed]" aria-hidden />
            </div>
          </CardContent>
        </DashboardCard>

        {/* Ingreso Ganado */}
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
        <KpiCard
          label="Citas"
          value={String(appointments.length)}
          sublabel={`${appointments.filter((a) => a.status === "showed").length} realizadas`}
          icon={CalendarDays}
          onClick={() =>
            setApptDrill({ open: true, title: "Todas las citas", appointments })
          }
        />
      </div>

      <DashboardCard>
        <ChartCardHeader
          title="Línea de tiempo de contactos y oportunidades"
          total={`${contacts.length.toLocaleString("es-MX")} contactos · ${opportunities.length.toLocaleString("es-MX")} oportunidades`}
          actions={
            <div className="flex rounded-lg border border-border bg-muted p-0.5">
              {([
                { key: "day" as const, label: "Diario" },
                { key: "week" as const, label: "Semanal" },
                { key: "month" as const, label: "Mensual" },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    timelineGran === opt.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setTimelineGran(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          }
        />
        <ChartCardContent>
          {timelineData.chartData.length === 0 ? (
            <ChartEmpty message="Sin datos para la línea de tiempo" height={192} />
          ) : (
            <>
              <ChartContainer
                config={{
                  contacts: { label: "Contactos", color: TIMELINE_CONTACTS_COLOR },
                  opps: { label: "Oportunidades", color: TIMELINE_OPPS_COLOR },
                }}
                style={{ height: 300 }}
                className="w-full"
              >
                <BarChart
                  data={timelineData.chartData}
                  margin={{ left: 8, right: 8, top: 16, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<NonZeroTooltipContent />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  <Bar
                    stackId="timeline"
                    dataKey="contacts"
                    name="Contactos"
                    fill={TIMELINE_CONTACTS_COLOR}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const b = timelineData.buckets.find((x) => x.key === data.key)
                      if (b && b.contacts.length > 0) openContactsDrill(`Contactos · ${b.label}`, b.contacts)
                    }}
                  />
                  <Bar
                    stackId="timeline"
                    dataKey="opps"
                    name="Oportunidades"
                    fill={TIMELINE_OPPS_COLOR}
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const b = timelineData.buckets.find((x) => x.key === data.key)
                      if (b && b.opps.length > 0) openDrill(`Oportunidades · ${b.label}`, b.opps)
                    }}
                  />
                </BarChart>
              </ChartContainer>
              <ChartHint>
                Barras apiladas: contactos y oportunidades creados por periodo · El selector solo cambia el eje X, no filtra · Haz clic en un segmento para ver los registros
              </ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      {/* ── Embudo de Ventas ───────────────────────── */}
      <SectionHeader title="Embudo de Ventas" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard>
          <ChartCardHeader title="Recorrido de la oportunidad" total={opportunities.length} />
          <ChartCardContent>
            {opportunities.length === 0 ? (
              <ChartEmpty message="Sin oportunidades para mostrar" height={192} />
            ) : (
              <>
                <div className="flex flex-col">
                  {funnelData.map((s, i) => {
                    const max = funnelData[0]?.count || 1
                    const prev = i > 0 ? funnelData[i - 1].count : 0
                    const conv = i > 0 && prev > 0 ? (s.count / prev) * 100 : null
                    return (
                      <div key={s.key}>
                        {i > 0 && conv !== null && conv <= 100 && (
                          <div className="flex items-center gap-1.5 py-1.5 pl-6 text-[11px] text-muted-foreground">
                            <span className="font-bold text-primary">↓</span>
                            <span className="font-semibold text-foreground/70 tabular-nums">{conv.toFixed(1)}%</span>
                            del paso anterior
                            {prev > s.count && (
                              <>
                                <span className="opacity-50">·</span>
                                <span className="tabular-nums">−{(prev - s.count).toLocaleString("es-MX")} no avanzaron</span>
                              </>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          className="group grid w-full grid-cols-[1fr_96px] items-center gap-3 text-left"
                          onClick={() => openDrill(s.label, s.opps)}
                        >
                          <div
                            className="flex h-11 items-center rounded-lg border px-3.5 transition-[filter] group-hover:brightness-110"
                            style={{
                              width: `${Math.max((s.count / max) * 100, 24)}%`,
                              minWidth: 170,
                              background: `${s.color}1f`,
                              borderColor: `${s.color}55`,
                              borderLeft: `4px solid ${s.color}`,
                            }}
                          >
                            <span
                              className="text-lg font-bold tabular-nums tracking-tight"
                              style={s.count === 0 ? { color: "#ef4444" } : undefined}
                            >
                              {s.count.toLocaleString("es-MX")}
                            </span>
                            <span className="ml-2.5 truncate text-xs font-medium text-foreground">{s.label}</span>
                          </div>
                          <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                            {((s.count / max) * 100).toFixed(1)}% del total
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </div>
                <ChartHint>
                  {funnelData.some((s) => s.key === "contacted") && "Contactados = oportunidades con al menos un mensaje o llamada · "}
                  Citas = el contacto de la oportunidad tiene una cita · Haz clic en una etapa para ver las oportunidades
                </ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>

        <DashboardCard>
          <ChartCardHeader
            title="Histórico de oportunidades y conversión a cita"
            total={`${monthlyFunnel.months.length} meses`}
          />
          <ChartCardContent>
            {monthlyFunnel.chartData.length === 0 ? (
              <ChartEmpty message="Sin datos históricos" height={192} />
            ) : (
              <>
                <ChartContainer
                  config={{
                    leads: { label: "Oportunidades creadas", color: STRUCTURAL_NAVY },
                    rate: { label: "Tasa Oportunidad → Cita (%)", color: BRAND_AMBER },
                  }}
                  style={{ height: 280 }}
                  className="w-full"
                >
                  <ComposedChart
                    data={monthlyFunnel.chartData}
                    margin={{ left: 8, right: 8, top: 16, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <ChartTooltip content={<NonZeroTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                    <Bar
                      yAxisId="left"
                      dataKey="leads"
                      name="Oportunidades creadas"
                      fill={STRUCTURAL_NAVY}
                      radius={[3, 3, 0, 0]}
                      cursor="pointer"
                      onClick={(data: any) => {
                        const month = monthlyFunnel.months.find((m) => m.key === data.key)
                        if (month) openDrill(`Oportunidades de ${month.label}`, month.leads)
                      }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="rate"
                      name="Tasa Oportunidad → Cita (%)"
                      stroke={BRAND_AMBER}
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: BRAND_AMBER }}
                    />
                  </ComposedChart>
                </ChartContainer>
                <ChartHint>
                  Barras: oportunidades creadas por mes · Línea: % de esas oportunidades que llegaron a cita · Haz clic en una barra para ver las oportunidades
                </ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>

      <DashboardCard>
        <ChartCardHeader title="Volumen y conversión por mes" />
        <ChartCardContent>
          {monthlyFunnel.months.length === 0 ? (
            <ChartEmpty message="Sin datos históricos" height={120} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Etapa
                      </th>
                      {monthlyFunnel.months.map((m, i) => (
                        <th
                          key={m.key}
                          className={`px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${
                            i === monthlyFunnel.months.length - 1 ? "bg-primary/10 rounded-t" : ""
                          }`}
                        >
                          {m.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { label: "Oportunidades creadas", get: (m: (typeof monthlyFunnel.months)[number]) => m.leads },
                      { label: "Llegaron a cita", get: (m: (typeof monthlyFunnel.months)[number]) => m.conCita },
                      { label: "Ganados", get: (m: (typeof monthlyFunnel.months)[number]) => m.ganados },
                    ] as const).map((row) => (
                      <tr key={row.label} className="border-b border-border">
                        <td className="px-3 py-2 font-medium text-foreground">{row.label}</td>
                        {monthlyFunnel.months.map((m, i) => {
                          const opps = row.get(m)
                          return (
                            <td
                              key={m.key}
                              className={`px-3 py-2 text-center ${i === monthlyFunnel.months.length - 1 ? "bg-primary/10 font-bold" : "font-semibold"}`}
                            >
                              <button
                                type="button"
                                className="tabular-nums hover:underline disabled:no-underline"
                                disabled={opps.length === 0}
                                onClick={() => openDrill(`${row.label} · ${m.label}`, opps)}
                              >
                                {opps.length.toLocaleString("es-MX")}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {([
                      { label: "Tasa Oportunidad → Cita", get: (m: (typeof monthlyFunnel.months)[number]) => m.citaRate },
                      { label: "Tasa Oportunidad → Ganado", get: (m: (typeof monthlyFunnel.months)[number]) => m.cierreRate },
                    ] as const).map((row, ri) => (
                      <tr key={row.label} className={ri === 0 ? "border-t-2 border-border" : ""}>
                        <td className="px-3 py-2 text-muted-foreground">{row.label}</td>
                        {monthlyFunnel.months.map((m, i) => (
                          <td
                            key={m.key}
                            className={`px-3 py-2 text-center italic tabular-nums text-muted-foreground ${
                              i === monthlyFunnel.months.length - 1 ? "bg-primary/10 font-bold rounded-b" : ""
                            }`}
                          >
                            {`${row.get(m).toFixed(1)}%`}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ChartHint>
                Cohorte mensual: cada columna sigue a las oportunidades creadas ese mes · Columna resaltada = mes más reciente · Haz clic en un número para ver las oportunidades
              </ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      {/* ── Origen de Oportunidades ────────────────── */}
      <SectionHeader title="Origen de Oportunidades" />
      <DashboardCard>
        <ChartCardHeader title="Origen de oportunidades y conversión a cita" total={opportunities.length} />
        <ChartCardContent>
          {origenData.length === 0 ? (
            <ChartEmpty message="Sin datos de origen" height={192} />
          ) : (
            <>
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                <div style={{ width: 180, height: 220, flexShrink: 0, position: "relative" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={origenData.map((o) => ({ name: o.platform, value: o.count }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={80}
                        dataKey="value"
                        nameKey="name"
                        startAngle={90}
                        endAngle={-270}
                        stroke="none"
                        paddingAngle={2}
                        activeIndex={hoveredOrigin}
                        activeShape={(props: any) => (
                          <Sector
                            cx={props.cx}
                            cy={props.cy}
                            innerRadius={props.innerRadius}
                            outerRadius={props.outerRadius + 5}
                            startAngle={props.startAngle}
                            endAngle={props.endAngle}
                            fill={props.fill}
                            stroke="none"
                          />
                        )}
                      >
                        {origenData.map((o) => (
                          <Cell key={o.platform} fill={o.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      textAlign: "center",
                      pointerEvents: "none",
                    }}
                  >
                    <div style={{ color: "hsl(var(--foreground))", fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                      {opportunities.length.toLocaleString("es-MX")}
                    </div>
                    <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 9, marginTop: 2 }}>OPORTUNIDADES</div>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="grid grid-cols-[minmax(80px,1fr)_minmax(0,1fr)_64px_64px] gap-2 border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[minmax(110px,160px)_1fr_90px_88px] sm:gap-3">
                    <span>Origen</span>
                    <span />
                    <span className="text-right">Oportunidades</span>
                    <span className="text-right">→ Citas</span>
                  </div>
                  {origenData.map((o, i) => {
                    const maxCount = origenData[0]?.count || 1
                    return (
                      <button
                        key={o.platform}
                        type="button"
                        className="grid w-full grid-cols-[minmax(80px,1fr)_minmax(0,1fr)_64px_64px] items-center gap-2 border-b border-border py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/20 sm:grid-cols-[minmax(110px,160px)_1fr_90px_88px] sm:gap-3"
                        onClick={() => openDrill(`Origen: ${o.platform}`, o.opps)}
                        onMouseEnter={() => setHoveredOrigin(i)}
                        onMouseLeave={() => setHoveredOrigin(undefined)}
                      >
                        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
                          <PlatformIcon platform={o.platform} />
                          <span className="truncate">{o.platform}</span>
                        </span>
                        <span className="h-2 overflow-hidden rounded bg-muted">
                          <span
                            className="block h-full rounded"
                            style={{ width: `${(o.count / maxCount) * 100}%`, background: o.color }}
                          />
                        </span>
                        <span className="text-right text-xs font-bold tabular-nums">
                          {o.count.toLocaleString("es-MX")}
                          <span className="ml-1 font-normal text-muted-foreground">· {o.pct.toFixed(1)}%</span>
                        </span>
                        <span
                          className="text-right text-xs font-bold tabular-nums"
                          style={{ color: o.citas.length > 0 ? o.color : undefined }}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (o.citas.length > 0) openDrill(`${o.platform} · Con cita`, o.citas)
                          }}
                        >
                          {o.citas.length > 0 ? (
                            <>
                              → {o.citas.length}
                              <span className="ml-1 font-normal text-muted-foreground">({o.citaRate.toFixed(0)}%)</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <ChartHint>
                → Citas = oportunidades de cada origen cuyo contacto tiene al menos una cita · Haz clic en una fila para ver las oportunidades
              </ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      {/* ── Salud del Pipeline ─────────────────────── */}
      <SectionHeader title="Salud del Pipeline" />
      <DashboardCard>
        <ChartCardHeader
          title="Estado actual del embudo por etapa"
          total={pipelineMatrix?.total ?? 0}
          actions={
            <div className="flex rounded-lg border border-border bg-muted p-0.5">
              {([
                { key: "asesor" as const, label: "Por asesor" },
                { key: "origen" as const, label: "Por origen" },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    matrixBy === opt.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setMatrixBy(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          }
        />
        <ChartCardContent>
          {!pipelineMatrix ? (
            <ChartEmpty message="Sin oportunidades para mostrar" height={192} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Etapa del pipeline
                      </th>
                      {pipelineMatrix.cols.map((c) => (
                        <th
                          key={c}
                          title={c}
                          className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          {c.length > 12 ? c.slice(0, 12) + "…" : c}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipelineMatrix.rows.map((row, ri) => (
                      <tr key={row.label} className="border-b border-border">
                        <td className="max-w-[220px] truncate px-3 py-1.5 font-medium text-foreground" title={row.label}>
                          <span
                            className="mr-2 inline-block h-1.5 w-1.5 rounded-sm align-middle"
                            style={{ background: row.dot }}
                          />
                          {row.label}
                        </td>
                        {pipelineMatrix.cells[ri].map((cellOpps, ci) => {
                          const v = cellOpps.length
                          const rgb =
                            row.kind === "lost" ? "239,68,68"
                            : row.kind === "won" ? "245,155,27"
                            : row.kind === "abandoned" ? "148,163,184"
                            : "59,130,246"
                          const max = row.kind === "lost" ? pipelineMatrix.lostMax : pipelineMatrix.liveMax
                          return (
                            <td key={ci} className="px-2 py-1 text-center">
                              {v === 0 ? (
                                <span className="text-muted-foreground/40">·</span>
                              ) : (
                                <button
                                  type="button"
                                  className="inline-block min-w-[30px] rounded-md px-2 py-0.5 font-semibold tabular-nums transition-[filter] hover:brightness-110"
                                  style={{ background: `rgba(${rgb},${(0.1 + Math.min(v / max, 1) * 0.4).toFixed(2)})` }}
                                  onClick={() =>
                                    openDrill(`${row.label} · ${pipelineMatrix.cols[ci]}`, cellOpps)
                                  }
                                >
                                  {v}
                                </button>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-3 py-1.5 text-center font-bold tabular-nums">{row.opps.length}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="px-3 pt-2 text-left font-bold">Total general</td>
                      {pipelineMatrix.cols.map((c) => (
                        <td key={c} className="px-2 pt-2 text-center font-bold tabular-nums">
                          {(pipelineMatrix.colTotals.get(c) ?? 0).toLocaleString("es-MX")}
                        </td>
                      ))}
                      <td className="px-3 pt-2 text-center font-bold tabular-nums">
                        {pipelineMatrix.total.toLocaleString("es-MX")}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <ChartHint>
                Intensidad = volumen de oportunidades · azul = pipeline abierto · ámbar = ganado · rojo = perdido · Haz clic en una celda para ver las oportunidades
              </ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      {/* ── Citas ──────────────────────────────────── */}
      <SectionHeader title="Citas" />
      <DashboardCard>
        <ChartCardHeader title="Resultado de las citas" total={appointments.length} />
        <ChartCardContent>
          {apptOutcomeData.length === 0 ? (
            <ChartEmpty message="Sin citas para mostrar" height={96} />
          ) : (
            <>
              <div className="flex h-14 w-full gap-0.5 overflow-hidden rounded-lg">
                {apptOutcomeData.map((seg) => (
                  <button
                    key={seg.status}
                    type="button"
                    className="flex min-w-[84px] flex-col justify-center px-3 text-left text-white transition-[filter] hover:brightness-110"
                    style={{ flexGrow: seg.count, flexBasis: 0, background: seg.color }}
                    onClick={() =>
                      setApptDrill({
                        open: true,
                        title: `Citas · ${seg.label}`,
                        appointments: seg.appts,
                      })
                    }
                  >
                    <span className="text-base font-bold leading-none tabular-nums">{seg.count}</span>
                    <span className="mt-1 truncate text-[10px] font-medium opacity-90">
                      {seg.label} · {seg.pct.toFixed(0)}%
                    </span>
                  </button>
                ))}
              </div>
              <ChartHint>Ancho proporcional al volumen · Haz clic en un segmento para ver las citas</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      {/* ── Análisis de Pérdidas ───────────────────── */}
      <SectionHeader title="Análisis de Pérdidas" />
      <DashboardCard>
        <ChartCardHeader title="Principales razones de pérdida" total={lossGroupsData.totalLost} />
        <ChartCardContent>
          {lossGroupsData.groups.length === 0 ? (
            <ChartEmpty message="Sin oportunidades perdidas" height={120} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {lossGroupsData.groups.map((g) => (
                  <button
                    key={g.reason}
                    type="button"
                    className="relative overflow-hidden rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/35"
                    onClick={() => openDrill(`Perdidos · ${g.reason}`, g.opps)}
                  >
                    <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: g.color }} />
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold tabular-nums tracking-tight" style={{ color: g.color }}>
                        {g.count.toLocaleString("es-MX")}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                        {g.pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs font-medium leading-snug text-foreground">{g.reason}</div>
                  </button>
                ))}
              </div>
              <ChartHint>% sobre el total de perdidos · Haz clic en una tarjeta para ver las oportunidades</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      {/* Appointment drill-down drawer */}
      <AppointmentDrillDrawer
        drill={apptDrill}
        onDrillChange={setApptDrill}
        contacts={lookupContacts}
      />

      {/* Drill-down drawer */}
      <ChartDrillDrawer
        drill={drill}
        onDrillChange={setDrill}
        contacts={lookupContacts}
        tasks={tasks}
        calls={calls}
        allOpportunities={opportunities}
        allPautas={pautas}
        appointments={appointments}
        messages={messages}
        locationId={locationId}
      />
    </DashboardShell>
  )
}
