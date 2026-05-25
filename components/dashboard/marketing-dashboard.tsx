"use client"

import { useState, useCallback, useMemo } from "react"
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Legend,
  PieChart,
  Pie,
  Sector,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { Opportunity, Contact, Pauta, Task, Call, Appointment } from "@/lib/types"
import { Megaphone, Globe, BarChart3, Layers, TrendingDown, Tag, FileText, Calendar } from "lucide-react"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"

interface MarketingDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  pautas: Pauta[]
  tasks?: Task[]
  calls?: Call[]
  appointments?: Appointment[]
  locationId?: string
}

// Normalize any createdAt format → "YYYY-MM-DD" (UTC). Handles ISO strings,
// Unix-ms numbers, numeric strings, and null/undefined.
function toUTCDateStr(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return ""
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10)
  const num = typeof val === "number" ? val : /^\d{10,}$/.test(val) ? Number(val) : NaN
  const d = new Date(isNaN(num) ? (val as string) : num)
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
}

// Stage colors — consistent across all stacked charts
const STAGE_COLORS: Record<string, string> = {
  "Primera Cita": "#3b82f6",
  "Segunda Cita": "#8b5cf6",
  "Envío de propuesta": "#f59e0b",
  "Envío de liga de pago": "#06b6d4",
  "Proceso de Implementación": "#10b981",
  "Cliente Activo": "#22c55e",
  "Servicio Terminado": "#6b7280",
  "Prospecto Perdido": "#ef4444",
  Discovery: "#3b82f6",
  Proposal: "#8b5cf6",
  Negotiation: "#f59e0b",
  "Closed Won": "#22c55e",
  "Closed Lost": "#ef4444",
}

const BAR_PALETTE = [
  "#2563eb", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6",
  "#06b6d4", "#f97316", "#22c55e", "#6366f1", "#84cc16",
  "#ef4444", "#0ea5e9", "#a855f7", "#14b8a6",
]

const LOST_REASON_PALETTE = [
  "#ef4444", "#f59e0b", "#f97316", "#dc2626", "#6b7280",
  "#8b5cf6", "#ec4899", "#0ea5e9", "#10b981", "#84cc16",
]

const AD_TYPE_COLORS: Record<string, string> = {
  Form: "#3b82f6",
  DM: "#06b6d4",
  Manual: "#10b981",
}

function adTypeColor(adType: string, index: number): string {
  return AD_TYPE_COLORS[adType] ?? BAR_PALETTE[index % BAR_PALETTE.length]
}

const FUNNEL_COLORS = [
  "#3b82f6", "#4f46e5", "#7c3aed", "#9333ea", "#c026d3", "#db2777",
]

const PAID_SOCIAL_SOURCES = ["meta", "facebook", "instagram", "tiktok", "fb", "snapchat", "pinterest"]
const PAID_SOCIAL_MEDIUMS = ["paid_social", "paidsocial", "paid social", "cpc", "cpm", "paid_search", "paid_ads"]

function isPaidSocial(opp: Opportunity): boolean {
  const src = (opp.source ?? "").toLowerCase()
  const med = (opp.adType ?? "").toLowerCase()
  return PAID_SOCIAL_SOURCES.some((s) => src.includes(s)) || PAID_SOCIAL_MEDIUMS.some((m) => med.includes(m))
}

function isLostStage(stage: string): boolean {
  const s = stage.toLowerCase()
  return s.includes("perdido") || s.includes("lost") || s.includes("terminado")
}

function barColor(i: number) { return BAR_PALETTE[i % BAR_PALETTE.length] }
function stageColor(stage: string, index: number) { return STAGE_COLORS[stage] ?? BAR_PALETTE[index % BAR_PALETTE.length] }

// Pauta names from GHL look like "HEADLINE - URL - NUMERIC_ID" with the
// headline repeating across many creatives. Truncating from the left collapses
// them into identical strings, so we extract the headline plus a short token
// from the URL path (e.g. Instagram shortcode, fb.me slug) for uniqueness.
function shortPautaName(full: string): string {
  const parts = full.split(" - ").map((s) => s.trim()).filter(Boolean)
  const head = parts[0] ?? full
  const url = parts[1] ?? ""
  let token = ""
  try {
    const u = new URL(url)
    const slug = u.pathname.split("/").filter(Boolean).pop() ?? ""
    token = slug || u.hostname.replace(/^www\./, "")
  } catch {
    token = ""
  }
  if (token.length > 10) token = token.slice(0, 10)
  const shortHead = head.length > 22 ? head.slice(0, 22) + "…" : head
  return token ? `${shortHead} · ${token}` : shortHead
}

function sourceLabel(opp: Opportunity): string {
  const parts: string[] = []
  if (opp.adType) parts.push(opp.adType)
  if (opp.source) parts.push(opp.source)
  return parts.length > 0 ? parts.join(" / ") : "Directo"
}

function NonZeroTooltipContent(props: any) {
  const filtered = (props.payload ?? []).filter((p: any) => Number(p?.value) > 0)
  if (!props.active || filtered.length === 0) return null
  return <ChartTooltipContent {...props} payload={filtered} />
}

function TotalBadge({ value }: { value: number | string }) {
  return (
    <span className="ml-auto inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
      Total: {typeof value === "number" ? value.toLocaleString() : value}
    </span>
  )
}

const iconCls = "h-4 w-4 shrink-0 text-muted-foreground"

export function MarketingDashboard({ opportunities, contacts, pautas, tasks = [], calls = [], appointments = [], locationId = "" }: MarketingDashboardProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const [hoveredAdType, setHoveredAdType] = useState<number | undefined>(undefined)

  const openDrill = useCallback((title: string, items: Opportunity[], subtitle?: string) => {
    setDrill({ open: true, title, subtitle, opportunities: items })
  }, [])

  const openPautaDrill = useCallback((title: string, pautaItems: Pauta[]) => {
    setDrill({ open: true, title, opportunities: [], pautas: pautaItems })
  }, [])

  // Derive ordered stage list from data
  const stageOrder = useMemo(() => {
    const preferred = [
      "Primera Cita", "Segunda Cita", "Envío de propuesta", "Envío de liga de pago",
      "Proceso de Implementación", "Cliente Activo", "Servicio Terminado", "Prospecto Perdido",
      "Discovery", "Proposal", "Negotiation", "Closed Won", "Closed Lost",
    ]
    const actual = new Set(opportunities.map((o) => o.stage))
    const ordered = preferred.filter((s) => actual.has(s))
    for (const s of actual) if (!ordered.includes(s)) ordered.push(s)
    return ordered
  }, [opportunities])

  // 1. Leads por Campaña
  const leadsByCampaign = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      const key = o.campaign || "Sin campaña"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([campaign, count]) => ({ campaign, count }))
  }, [opportunities])

  // 2. Leads por Fuente
  const leadsBySource = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      const key = sourceLabel(o)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([source, count]) => ({ source, count }))
  }, [opportunities])

  // 3. Campaña por Etapa del Pipeline
  const campaignByStage = useMemo(() => {
    const campaigns = Array.from(new Set(opportunities.map((o) => o.campaign || "Sin campaña")))
    return campaigns
      .map((campaign) => {
        const row: Record<string, string | number> = { campaign }
        for (const stage of stageOrder) {
          row[stage] = opportunities.filter(
            (o) => (o.campaign || "Sin campaña") === campaign && o.stage === stage
          ).length
        }
        return row
      })
      .filter((row) => stageOrder.some((s) => (row[s] as number) > 0))
      .sort((a, b) => {
        const sumA = stageOrder.reduce((acc, s) => acc + ((a[s] as number) || 0), 0)
        const sumB = stageOrder.reduce((acc, s) => acc + ((b[s] as number) || 0), 0)
        return sumB - sumA
      })
      .slice(0, 10)
  }, [opportunities, stageOrder])

  // 4. Fuente por Etapa del Pipeline
  const sourceByStage = useMemo(() => {
    const sources = Array.from(new Set(opportunities.map((o) => sourceLabel(o))))
    return sources
      .map((source) => {
        const row: Record<string, string | number> = { source }
        for (const stage of stageOrder) {
          row[stage] = opportunities.filter(
            (o) => sourceLabel(o) === source && o.stage === stage
          ).length
        }
        return row
      })
      .filter((row) => stageOrder.some((s) => (row[s] as number) > 0))
      .sort((a, b) => {
        const sumA = stageOrder.reduce((acc, s) => acc + ((a[s] as number) || 0), 0)
        const sumB = stageOrder.reduce((acc, s) => acc + ((b[s] as number) || 0), 0)
        return sumB - sumA
      })
      .slice(0, 10)
  }, [opportunities, stageOrder])

  const stageChartConfig = Object.fromEntries(
    stageOrder.map((stage, i) => [stage, { label: stage, color: stageColor(stage, i) }])
  )

  // 5. Leads Perdidos por Campaña y Razón
  const lostOpps = useMemo(() => opportunities.filter((o) => o.status === "lost"), [opportunities])

  const lostReasons = useMemo(() => {
    const s = new Set(lostOpps.map((o) => o.lostReason || "Sin razón"))
    return Array.from(s).sort()
  }, [lostOpps])

  const lostByCampaignReason = useMemo(() => {
    const campaigns = Array.from(new Set(lostOpps.map((o) => o.campaign || "Sin campaña")))
    return campaigns
      .map((campaign) => {
        const row: Record<string, string | number> = { campaign }
        for (const reason of lostReasons) {
          row[reason] = lostOpps.filter(
            (o) => (o.campaign || "Sin campaña") === campaign && (o.lostReason || "Sin razón") === reason
          ).length
        }
        return row
      })
      .filter((row) => lostReasons.some((r) => (row[r] as number) > 0))
      .sort((a, b) => {
        const sumA = lostReasons.reduce((acc, r) => acc + ((a[r] as number) || 0), 0)
        const sumB = lostReasons.reduce((acc, r) => acc + ((b[r] as number) || 0), 0)
        return sumB - sumA
      })
      .slice(0, 10)
  }, [lostOpps, lostReasons])

  const lostReasonConfig = Object.fromEntries(
    lostReasons.map((r, i) => [r, { label: r, color: LOST_REASON_PALETTE[i % LOST_REASON_PALETTE.length] }])
  )

  // 6. Leads por Tipo de Anuncio (donut)
  const leadsByAdType = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      const key = o.adType || "Otro"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([adType, value], i) => ({ adType, value, color: adTypeColor(adType, i) }))
  }, [opportunities])

  // 7. Embudo Paid Social
  const paidSocialFunnel = useMemo(() => {
    const paid = opportunities.filter((o) => isPaidSocial(o) && !isLostStage(o.stage))
    const counts = new Map<string, number>()
    for (const o of paid) counts.set(o.stage, (counts.get(o.stage) ?? 0) + 1)
    return stageOrder
      .filter((s) => !isLostStage(s) && counts.has(s))
      .map((stage) => ({ stage, count: counts.get(stage)! }))
  }, [opportunities, stageOrder])

  const pautasByTipo = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of pautas) counts.set(p.tipo, (counts.get(p.tipo) ?? 0) + 1)
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tipo, count]) => ({ tipo, count }))
  }, [pautas])

  const pautasByNombre = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of pautas) counts.set(p.nombrePauta, (counts.get(p.nombrePauta) ?? 0) + 1)
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([nombre, count]) => ({ nombre, count }))
  }, [pautas])

  // contactId → { pautaName → Pauta[] } so we can both count opps per pauta
  // and surface the matching pautas in the drill-down.
  const contactToPautas = useMemo(() => {
    const m = new Map<string, Map<string, Pauta[]>>()
    for (const p of pautas) {
      if (!p.contactId) continue
      let byName = m.get(p.contactId)
      if (!byName) {
        byName = new Map<string, Pauta[]>()
        m.set(p.contactId, byName)
      }
      const arr = byName.get(p.nombrePauta) ?? []
      arr.push(p)
      byName.set(p.nombrePauta, arr)
    }
    return m
  }, [pautas])

  // Pauta × Etapa del Pipeline (stacked bar: X = stage, Y = opp count, color = pauta name).
  // A contact may have multiple pautas — an opportunity is counted once per linked pauta,
  // so stacked totals can exceed opp count when contacts have multiple pautas attached.
  const { pautaByStageRows, pautaByStageKeys } = useMemo(() => {
    const totals = new Map<string, number>()
    const perStage = new Map<string, Map<string, number>>()
    for (const stage of stageOrder) perStage.set(stage, new Map())

    for (const opp of opportunities) {
      const byName = contactToPautas.get(opp.contactId)
      if (!byName) continue
      const stageMap = perStage.get(opp.stage)
      if (!stageMap) continue
      for (const name of byName.keys()) {
        stageMap.set(name, (stageMap.get(name) ?? 0) + 1)
        totals.set(name, (totals.get(name) ?? 0) + 1)
      }
    }

    const keys = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name]) => name)

    const rows = stageOrder
      .map((stage) => {
        const row: Record<string, string | number> = { stage }
        const stageMap = perStage.get(stage)!
        for (const k of keys) row[k] = stageMap.get(k) ?? 0
        return row
      })
      .filter((row) => keys.some((k) => (row[k] as number) > 0))

    return { pautaByStageRows: rows, pautaByStageKeys: keys }
  }, [opportunities, contactToPautas, stageOrder])

  const pautaByStageConfig = Object.fromEntries(
    pautaByStageKeys.map((k, i) => [k, { label: shortPautaName(k), color: BAR_PALETTE[i % BAR_PALETTE.length] }])
  )

  const pautaByStageTotal = pautaByStageRows.reduce(
    (s, r) => s + pautaByStageKeys.reduce((a, k) => a + ((r[k] as number) || 0), 0),
    0
  )

  // Pautas grouped by calendar month (YYYY-MM), stacked by tipo.
  const { pautasByMonthRows, pautasByMonthKeys } = useMemo(() => {
    if (pautas.length === 0) return { pautasByMonthRows: [], pautasByMonthKeys: [] }

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

    const keys = Array.from(tipoTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)

    const sortedMonths = Array.from(byMonth.keys()).sort()

    const rows = sortedMonths.map((monthKey) => {
      const label = new Date(monthKey + "-15T12:00:00Z")
        .toLocaleDateString("es-MX", { month: "short", year: "2-digit" })
      const row: Record<string, string | number> = { monthKey, monthLabel: label }
      const tipoMap = byMonth.get(monthKey)!
      for (const k of keys) row[k] = tipoMap.get(k) ?? 0
      return row
    })

    return { pautasByMonthRows: rows, pautasByMonthKeys: keys }
  }, [pautas])

  // Last 30 days from today, grouped by adType (fuente del CRM).
  const { oppsByDayRows, oppsByDayKeys } = useMemo(() => {
    if (opportunities.length === 0) return { oppsByDayRows: [], oppsByDayKeys: [] }

    // Build 30-day window ending today (UTC)
    const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T12:00:00Z").getTime()
    const days: string[] = []
    for (let i = 29; i >= 0; i--) {
      days.push(new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10))
    }
    const daySet = new Set(days)

    // Map each opportunity to its UTC date string
    const oppDates = opportunities.map((o) => toUTCDateStr(o.createdAt as string | number | null | undefined))

    // Unique adType keys in window, ranked by volume
    const adTypeTotals = new Map<string, number>()
    for (let i = 0; i < opportunities.length; i++) {
      if (!daySet.has(oppDates[i])) continue
      const key = opportunities[i].adType || "Otro"
      adTypeTotals.set(key, (adTypeTotals.get(key) ?? 0) + 1)
    }
    const keys = Array.from(adTypeTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)

    if (keys.length === 0) return { oppsByDayRows: [], oppsByDayKeys: [] }

    const rows = days.map((isoDay) => {
      const row: Record<string, string | number> = { day: isoDay.slice(5), isoDay }
      for (const k of keys) row[k] = 0
      for (let i = 0; i < opportunities.length; i++) {
        if (oppDates[i] !== isoDay) continue
        const k = opportunities[i].adType || "Otro"
        row[k] = (row[k] as number) + 1
      }
      return row
    })

    return { oppsByDayRows: rows, oppsByDayKeys: keys }
  }, [opportunities])

  return (
    <div className="flex flex-col gap-4 px-6 pb-6">

      {/* Row 1: Oportunidades por fuente del CRM + Pautas por Tipo */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Donut + ranked bar list by ad type */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Tag className={iconCls} />
            <CardTitle className="text-sm font-semibold">Oportunidades por fuente del CRM</CardTitle>
            <TotalBadge value={opportunities.length} />
          </CardHeader>
          <CardContent>
            {leadsByAdType.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                Sin datos de tipo de anuncio.
              </div>
            ) : (() => {
              const total = leadsByAdType.reduce((s, e) => s + e.value, 0)
              const maxVal = leadsByAdType[0].value
              return (
                <div className="flex items-center gap-4">
                  {/* Donut — center label via absolute positioning (more reliable than SVG text in Recharts) */}
                  <div style={{ width: 160, height: 200, flexShrink: 0, position: "relative" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={leadsByAdType}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={72}
                          dataKey="value"
                          nameKey="adType"
                          startAngle={90}
                          endAngle={-270}
                          stroke="none"
                          paddingAngle={2}
                          activeIndex={hoveredAdType}
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
                          {leadsByAdType.map((entry) => (
                            <Cell key={entry.adType} fill={entry.color} />
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
                      <div style={{ color: "hsl(var(--foreground))", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{total}</div>
                      <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 9, marginTop: 2 }}>LEADS</div>
                    </div>
                  </div>

                  {/* Ranked bar list */}
                  <div className="flex flex-1 flex-col gap-y-2.5">
                    {leadsByAdType.map((entry, i) => {
                      const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0
                      const barWidth = maxVal > 0 ? (entry.value / maxVal) * 100 : 0
                      const label = entry.adType.length > 18 ? entry.adType.slice(0, 18) + "…" : entry.adType
                      return (
                        <div
                          key={entry.adType}
                          className="cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-accent/20 transition-colors"
                          onClick={() =>
                            openDrill(
                              `Tipo de Anuncio: ${entry.adType}`,
                              opportunities.filter((o) => (o.adType || "Otro") === entry.adType)
                            )
                          }
                          onMouseEnter={() => setHoveredAdType(i)}
                          onMouseLeave={() => setHoveredAdType(undefined)}
                        >
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-xs text-foreground">{label}</span>
                            <span className="text-xs text-muted-foreground tabular-nums ml-2 shrink-0">
                              {entry.value} · {pct}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded bg-muted overflow-hidden">
                            <div
                              className="h-full rounded transition-all"
                              style={{ width: `${barWidth}%`, backgroundColor: entry.color }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              Haz clic en una fila para ver los leads
            </p>
          </CardContent>
        </Card>

        {/* Pautas por Tipo */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <FileText className={iconCls} />
            <CardTitle className="text-sm font-semibold">Pautas por Tipo</CardTitle>
            <TotalBadge value={pautas.length} />
          </CardHeader>
          <CardContent>
            {pautasByTipo.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                Sin datos de Pautas.
              </div>
            ) : (
              <>
                <ChartContainer config={{ count: { label: "Pautas", color: "#2563eb" } }} className="aspect-auto" style={{ height: Math.max(220, pautasByTipo.length * 44 + 20) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={pautasByTipo} margin={{ top: 5, right: 30, left: 8, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="tipo" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} width={150} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.tipo ?? String(_)} />} />
                      <Bar
                        dataKey="count"
                        radius={[0, 6, 6, 0]}
                        name="Pautas"
                        maxBarSize={32}
                        cursor="pointer"
                        onClick={(data: any) => openPautaDrill(
                          `Tipo: ${data.tipo}`,
                          pautas.filter((p) => p.tipo === data.tipo)
                        )}
                      >
                        {pautasByTipo.map((entry, i) => (
                          <Cell key={entry.tipo} fill={barColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver las pautas</p>
              </>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Row 2: Oportunidades creadas por tiempo y fuente — full width */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <BarChart3 className={iconCls} />
          <CardTitle className="text-sm font-semibold">Oportunidades creadas por tiempo y fuente (últimos 30 días)</CardTitle>
          <TotalBadge value={oppsByDayRows.reduce((s, r) => s + oppsByDayKeys.reduce((a, k) => a + ((r[k] as number) || 0), 0), 0)} />
        </CardHeader>
        <CardContent>
          {oppsByDayKeys.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
              Sin datos en los últimos 30 días.
            </div>
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  oppsByDayKeys.map((k, i) => [k, { label: k, color: BAR_PALETTE[i % BAR_PALETTE.length] }])
                )}
                className="aspect-auto"
                style={{ height: 280 }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oppsByDayRows} margin={{ top: 5, right: 16, left: 8, bottom: 5 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={false}
                      interval={4}
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
                    {oppsByDayKeys.map((key, i) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="a"
                        fill={BAR_PALETTE[i % BAR_PALETTE.length]}
                        radius={i === oppsByDayKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        maxBarSize={40}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const count = data[key] as number
                          if (!count) return
                          const isoDate = data.isoDay as string
                          const items = opportunities.filter(
                            (o) =>
                              toUTCDateStr(o.createdAt as string | number | null | undefined) === isoDate &&
                              (o.adType || "Otro") === key
                          )
                          openDrill(
                            `${key} · ${data.day}`,
                            items,
                            `${items.length} oportunidad${items.length !== 1 ? "es" : ""} el ${isoDate}`
                          )
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <p className="mt-1 text-center text-[10px] text-muted-foreground">Apilado por fuente del CRM · eje X cada 5 días</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Row 3: Pautas por Nombre — full width */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <FileText className={iconCls} />
          <CardTitle className="text-sm font-semibold">Pautas por Nombre (Top 30)</CardTitle>
          <TotalBadge value={pautas.length} />
        </CardHeader>
        <CardContent>
          {pautasByNombre.length === 0 ? (
            <div className="flex h-[520px] items-center justify-center text-sm text-muted-foreground">
              Sin datos de Pautas.
            </div>
          ) : (
            <>
              <ChartContainer config={{ count: { label: "Pautas", color: "#2563eb" } }} className="aspect-auto" style={{ height: 380 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pautasByNombre} margin={{ top: 5, right: 16, left: 8, bottom: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis
                      dataKey="nombre"
                      type="category"
                      tick={{ fontSize: 10, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-45}
                      textAnchor="end"
                      tickFormatter={(v: string) => v.length > 28 ? v.slice(0, 28) + "…" : v}
                    />
                    <YAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.nombre ?? String(_)} />} />
                    <Bar
                      dataKey="count"
                      radius={[6, 6, 0, 0]}
                      name="Pautas"
                      maxBarSize={32}
                      cursor="pointer"
                      onClick={(data: any) => openPautaDrill(
                        `Pauta: ${data.nombre}`,
                        pautas.filter((p) => p.nombrePauta === data.nombre)
                      )}
                    >
                      {pautasByNombre.map((entry, i) => (
                        <Cell key={entry.nombre} fill={barColor(i)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <p className="mt-1 text-center text-[10px] text-muted-foreground">Haz clic en una barra para ver las pautas</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Row 4: Pautas por Etapa del Pipeline — stacked bars (X: stage, Y: opp count, color: pauta) */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Layers className={iconCls} />
          <CardTitle className="text-sm font-semibold">Pautas por Etapa del Pipeline</CardTitle>
          <TotalBadge value={pautaByStageTotal} />
        </CardHeader>
        <CardContent>
          {pautaByStageKeys.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
              Sin oportunidades vinculadas a pautas.
            </div>
          ) : (
            <>
              <ChartContainer config={pautaByStageConfig} className="aspect-auto" style={{ height: 480 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pautaByStageRows} margin={{ top: 5, right: 16, left: 8, bottom: 140 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis
                      dataKey="stage"
                      tick={{ fontSize: 10, fill: "#6b7280" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-25}
                      textAnchor="end"
                      tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 22) + "…" : v}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<NonZeroTooltipContent />} />
                    <Legend
                      wrapperStyle={{ fontSize: 10, paddingTop: 8, lineHeight: "16px" }}
                      iconSize={8}
                      formatter={(value: string) => (
                        <span
                          style={{ color: "#374151", marginRight: 4 }}
                          title={value}
                        >
                          {shortPautaName(value)}
                        </span>
                      )}
                    />
                    {pautaByStageKeys.map((key, i) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="a"
                        fill={BAR_PALETTE[i % BAR_PALETTE.length]}
                        radius={i === pautaByStageKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        maxBarSize={56}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const count = data[key] as number
                          if (!count) return
                          const stage = data.stage as string
                          const items = opportunities.filter((o) => {
                            if (o.stage !== stage) return false
                            const byName = contactToPautas.get(o.contactId)
                            return byName?.has(key) ?? false
                          })
                          openDrill(
                            `${key} · ${stage}`,
                            items,
                            `${items.length} oportunidad${items.length !== 1 ? "es" : ""} en ${stage}`
                          )
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <p className="mt-1 text-center text-[10px] text-muted-foreground">
                Apilado por Pauta · top 30 pautas · haz clic en un segmento para ver las oportunidades
              </p>
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
        appointments={appointments}
        locationId={locationId}
      />
    </div>
  )
}
