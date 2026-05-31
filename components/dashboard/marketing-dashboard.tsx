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
import {
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import type { Opportunity, Contact, Pauta, Task, Call, Appointment } from "@/lib/types"
import { Tag, FileText, Calendar, BarChart3, Layers, TrendingUp, Facebook, Instagram, Copy, Check } from "lucide-react"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"
import {
  BRAND_AMBER,
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
  MarketingSummaryStrip,
  NonZeroTooltipContent,
} from "./dashboard-ui"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface MarketingDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  pautas: Pauta[]
  tasks?: Task[]
  calls?: Call[]
  appointments?: Appointment[]
  locationId?: string
  onAnalyzeWithAI?: (initialMessage: string) => void
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

// CHART_PALETTE imported from dashboard-ui (amber-led)

const LOST_REASON_PALETTE = [
  "#ef4444", "#f59e0b", "#f97316", "#dc2626", "#6b7280",
  "#8b5cf6", "#ec4899", "#0ea5e9", "#10b981", "#84cc16",
]

const AD_TYPE_COLORS: Record<string, string> = {
  Form: BRAND_AMBER,
  DM: "#335577",
  Manual: "#10b981",
}

function adTypeColor(adType: string, index: number): string {
  return AD_TYPE_COLORS[adType] ?? chartPaletteColor(index)
}

const FUNNEL_COLORS = [
  "#3b82f6", "#4f46e5", "#7c3aed", "#9333ea", "#c026d3", "#db2777",
]

const PAID_SOCIAL_SOURCES = ["meta", "facebook", "instagram", "tiktok", "fb", "snapchat", "pinterest"]
const PAID_SOCIAL_MEDIUMS = ["paid_social", "paidsocial", "paid social", "cpc", "cpm", "paid_search", "paid_ads"]

const PAID_SEARCH_SOURCES = ["google", "bing", "yahoo", "baidu", "duckduckgo"]
const PAID_SEARCH_MEDIUMS = ["cpc", "ppc", "paid_search", "paidsearch", "google_ads", "sem"]

function isPaidTraffic(opp: Opportunity): boolean {
  const src = (opp.source ?? "").toLowerCase()
  const med = (opp.adType ?? "").toLowerCase()
  return (
    PAID_SOCIAL_SOURCES.some((s) => src.includes(s)) ||
    PAID_SOCIAL_MEDIUMS.some((m) => med.includes(m)) ||
    PAID_SEARCH_SOURCES.some((s) => src.includes(s)) ||
    PAID_SEARCH_MEDIUMS.some((m) => med.includes(m))
  )
}

function isPaidSocial(opp: Opportunity): boolean {
  const src = (opp.source ?? "").toLowerCase()
  const med = (opp.adType ?? "").toLowerCase()
  return PAID_SOCIAL_SOURCES.some((s) => src.includes(s)) || PAID_SOCIAL_MEDIUMS.some((m) => med.includes(m))
}

function isLostStage(stage: string): boolean {
  const s = stage.toLowerCase()
  return s.includes("perdido") || s.includes("lost") || s.includes("terminado")
}

function stageColor(stage: string, index: number) { return STAGE_COLORS[stage] ?? chartPaletteColor(index) }

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

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return (u.hostname + u.pathname).replace(/\/$/, "").toLowerCase()
  } catch {
    return ""
  }
}

// Landing URLs in this location are the social links themselves:
// instagram.com/p/… (Instagram) and fb.me/… (Facebook).
function urlPlatform(url: string): "facebook" | "instagram" | null {
  const u = url.toLowerCase()
  if (u.includes("instagram.com")) return "instagram"
  if (u.includes("fb.me") || u.includes("facebook.com") || u.includes("fb.com")) return "facebook"
  return null
}

// Show a compact label for a social URL (the path slug) while keeping the
// full URL available via title for the tooltip.
function shortUrlLabel(raw: string): string {
  try {
    const u = new URL(raw)
    const slug = u.pathname.replace(/\/$/, "").split("/").pop() || u.hostname
    return slug.length > 22 ? slug.slice(0, 22) + "…" : slug
  } catch {
    return raw.length > 22 ? raw.slice(0, 22) + "…" : raw
  }
}

function paidTrafficUrlLabel(url: string): string {
  const platform = urlPlatform(url)
  const prefix = platform === "facebook" ? "FB - " : platform === "instagram" ? "IG - " : ""
  try {
    const u = new URL(url)
    const slug = u.pathname.replace(/\/$/, "").split("/").filter(Boolean).pop() || u.hostname
    const truncated = slug.length > 22 ? slug.slice(0, 22) + "…" : slug
    return prefix + truncated
  } catch {
    const truncated = url.length > 22 ? url.slice(0, 22) + "…" : url
    return prefix + truncated
  }
}

function extractPautaUrl(nombrePauta: string): string {
  const parts = nombrePauta.split(" - ").map((s) => s.trim()).filter(Boolean)
  const url = parts[1] ?? ""
  return normalizeUrl(url)
}

function sourceLabel(opp: Opportunity): string {
  const parts: string[] = []
  if (opp.adType) parts.push(opp.adType)
  if (opp.source) parts.push(opp.source)
  return parts.length > 0 ? parts.join(" / ") : "Directo"
}


function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="ml-1.5 inline-flex shrink-0 items-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      title={`Copiar: ${value}`}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

type PaidGroupBy = "url" | "id"

function GroupByToggle({ value, onChange }: { value: PaidGroupBy; onChange: (v: PaidGroupBy) => void }) {
  return (
    <div className="flex items-center overflow-hidden rounded border border-border/50 text-[10px] font-medium">
      {(["url", "id"] as PaidGroupBy[]).map((opt, i) => (
        <button
          key={opt}
          onClick={(e) => { e.stopPropagation(); onChange(opt) }}
          className={[
            "px-2 py-0.5 transition-colors uppercase tracking-wide",
            i > 0 ? "border-l border-border/50" : "",
            value === opt
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
          ].join(" ")}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export function MarketingDashboard({ opportunities, contacts, pautas, tasks = [], calls = [], appointments = [], locationId = "", onAnalyzeWithAI }: MarketingDashboardProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const [hoveredAdType, setHoveredAdType] = useState<number | undefined>(undefined)
  const [apptGroupBy, setApptGroupBy] = useState<PaidGroupBy>("url")
  const [wonGroupBy, setWonGroupBy] = useState<PaidGroupBy>("url")
  const [stageGroupBy, setStageGroupBy] = useState<PaidGroupBy>("url")

  const openDrill = useCallback((title: string, items: Opportunity[], subtitle?: string) => {
    setDrill({ open: true, title, subtitle, opportunities: items })
  }, [])

  const openPautaDrill = useCallback((title: string, pautaItems: Pauta[]) => {
    const contactIds = new Set(pautaItems.map(p => p.contactId).filter((id): id is string => Boolean(id)))
    const opps = opportunities.filter(o => contactIds.has(o.contactId))
    setDrill({ open: true, title, opportunities: opps })
  }, [opportunities])

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

  // Attribution (URL or Ad ID) × Etapa del Pipeline (stacked bar: X = stage, Y = opp count, color = attribution key).
  const { pautaByStageRows, pautaByStageKeys } = useMemo(() => {
    const totals = new Map<string, number>()
    const perStage = new Map<string, Map<string, number>>()
    for (const stage of stageOrder) perStage.set(stage, new Map())

    for (const opp of opportunities) {
      const rawKey = stageGroupBy === "url" ? opp.attributionUrl : opp.adId
      if (!rawKey) continue
      const stageMap = perStage.get(opp.stage)
      if (!stageMap) continue
      stageMap.set(rawKey, (stageMap.get(rawKey) ?? 0) + 1)
      totals.set(rawKey, (totals.get(rawKey) ?? 0) + 1)
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
  }, [opportunities, stageOrder, stageGroupBy])

  const pautaByStageConfig = Object.fromEntries(
    pautaByStageKeys.map((k, i) => [
      k,
      { label: stageGroupBy === "url" ? paidTrafficUrlLabel(k) : k, color: CHART_PALETTE[i % CHART_PALETTE.length] },
    ])
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

  const paidSocialLeadCount = useMemo(
    () => opportunities.filter((o) => isPaidSocial(o)).length,
    [opportunities],
  )

  // Panel 2 — Opportunities by Ad ID (table)
  const leadsByAdId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      if (!o.adId) continue
      counts.set(o.adId, (counts.get(o.adId) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([adId, count]) => ({ adId, count }))
  }, [opportunities])

  // Panel 3 — Landing URLs split by platform (Facebook vs Instagram)
  const leadsByPlatformUrl = useMemo(() => {
    const fb = new Map<string, number>()
    const ig = new Map<string, number>()
    for (const o of opportunities) {
      const url = o.attributionUrl
      if (!url) continue
      const platform = urlPlatform(url)
      if (platform === "facebook") fb.set(url, (fb.get(url) ?? 0) + 1)
      else if (platform === "instagram") ig.set(url, (ig.get(url) ?? 0) + 1)
    }
    const toRows = (m: Map<string, number>) =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([url, count]) => ({ url, count }))
    return { fb: toRows(fb), ig: toRows(ig) }
  }, [opportunities])

  // Panel 4a — Paid traffic leads with at least one appointment
  const paidTrafficWithAppt = useMemo(() => {
    const apptContactIds = new Set(appointments.map((a) => a.contactId))
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      if (!isPaidTraffic(o)) continue
      if (!apptContactIds.has(o.contactId)) continue
      const rawKey = apptGroupBy === "url" ? o.attributionUrl : o.adId
      if (!rawKey) continue
      counts.set(rawKey, (counts.get(rawKey) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([rawKey, count]) => ({
        rawKey,
        label: apptGroupBy === "url" ? paidTrafficUrlLabel(rawKey) : rawKey,
        count,
      }))
  }, [opportunities, appointments, apptGroupBy])

  // Panel 4b — Won deals from paid traffic, grouped by URL or Ad ID
  const wonPaidTraffic = useMemo(() => {
    const counts = new Map<string, { count: number; value: number }>()
    for (const o of opportunities) {
      if (!isPaidTraffic(o) || o.status !== "won") continue
      const rawKey = wonGroupBy === "url" ? o.attributionUrl : o.adId
      if (!rawKey) continue
      const prev = counts.get(rawKey) ?? { count: 0, value: 0 }
      counts.set(rawKey, { count: prev.count + 1, value: prev.value + o.value })
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([rawKey, { count, value }]) => ({
        rawKey,
        label: wonGroupBy === "url" ? paidTrafficUrlLabel(rawKey) : rawKey,
        count,
        value,
      }))
  }, [opportunities, wonGroupBy])

  const { apptsByPautaRows, apptsByPautaKeys } = useMemo(() => {
    if (appointments.length === 0 || pautas.length === 0) {
      return { apptsByPautaRows: [], apptsByPautaKeys: [] }
    }

    const contactUrlMap = new Map<string, string>()
    for (const c of contacts) {
      if (c.attributionUrl) {
        const norm = normalizeUrl(c.attributionUrl)
        if (norm) contactUrlMap.set(c.id, norm)
      }
    }

    const urlToPauta = new Map<string, string>()
    for (const p of pautas) {
      const norm = extractPautaUrl(p.nombrePauta)
      if (norm && !urlToPauta.has(norm)) {
        urlToPauta.set(norm, p.nombrePauta)
      }
    }

    const counts = new Map<string, Map<string, number>>()
    const pautaTotals = new Map<string, number>()

    for (const appt of appointments) {
      const normUrl = contactUrlMap.get(appt.contactId)
      if (!normUrl) continue
      const pautaName = urlToPauta.get(normUrl)
      if (!pautaName) continue

      const status = appt.status || "Sin estatus"
      if (!counts.has(pautaName)) counts.set(pautaName, new Map())
      const statusMap = counts.get(pautaName)!
      statusMap.set(status, (statusMap.get(status) ?? 0) + 1)
      pautaTotals.set(pautaName, (pautaTotals.get(pautaName) ?? 0) + 1)
    }

    const topPautas = Array.from(pautaTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name]) => name)

    const statusTotals = new Map<string, number>()
    for (const [, statusMap] of counts) {
      for (const [status, count] of statusMap) {
        statusTotals.set(status, (statusTotals.get(status) ?? 0) + count)
      }
    }
    const statusKeys = Array.from(statusTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)

    const rows = topPautas.map((pautaName) => {
      const row: Record<string, string | number> = { pauta: pautaName }
      const statusMap = counts.get(pautaName)!
      for (const k of statusKeys) row[k] = statusMap.get(k) ?? 0
      return row
    })

    return { apptsByPautaRows: rows, apptsByPautaKeys: statusKeys }
  }, [appointments, pautas, contacts])

  return (
    <DashboardShell>
      <MarketingSummaryStrip
        opportunities={opportunities.length}
        pautas={pautas.length}
        paidSocialLeads={paidSocialLeadCount}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard>
          <ChartCardHeader
            title="Oportunidades por fuente del CRM"
            total={opportunities.length}
            icon={Tag}
          />
          <ChartCardContent>
            {leadsByAdType.length === 0 ? (
              <ChartEmpty message="Sin datos de tipo de anuncio." height={200} />
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
            <ChartHint>Haz clic en una fila para ver los leads</ChartHint>
          </ChartCardContent>
        </DashboardCard>

        <DashboardCard>
          <ChartCardHeader title="Pautas por Tipo" total={pautas.length} icon={FileText} />
          <ChartCardContent>
            {pautasByTipo.length === 0 ? (
              <ChartEmpty message="Sin datos de Pautas." height={220} />
            ) : (
              <>
                <ChartContainer config={{ count: { label: "Pautas", color: BRAND_AMBER } }} className="aspect-auto" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pautasByTipo} margin={{ top: 5, right: 8, left: 8, bottom: 70 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="tipo" tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} interval={0} angle={-40} textAnchor="end" tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 20) + "…" : v} />
                      <YAxis tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <ChartTooltip content={<NonZeroTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.tipo ?? String(_)} />} />
                      <Bar
                        dataKey="count"
                        radius={[6, 6, 0, 0]}
                        name="Pautas"
                        maxBarSize={48}
                        cursor="pointer"
                        onClick={(data: any) => openPautaDrill(
                          `Tipo: ${data.tipo}`,
                          pautas.filter((p) => p.tipo === data.tipo)
                        )}
                      >
                        {pautasByTipo.map((entry, i) => (
                          <Cell key={entry.tipo} fill={chartPaletteColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <ChartHint>Haz clic en una barra para ver las pautas</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>

      <DashboardCard>
        <ChartCardHeader title="Pautas creadas por Mes" total={pautas.length} icon={Calendar} />
        <ChartCardContent>
          {pautasByMonthKeys.length === 0 ? (
            <ChartEmpty message="Sin datos de Pautas." height={280} />
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  pautasByMonthKeys.map((k, i) => [k, { label: k, color: CHART_PALETTE[i % CHART_PALETTE.length] }])
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
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                    <XAxis
                      dataKey="monthLabel"
                      tick={{ fontSize: 10, fill: CHART_TICK.fill }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-45}
                      textAnchor="end"
                    />
                    <YAxis
                      tick={{ ...CHART_TICK }}
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
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
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
              <ChartHint>Apilado por tipo · haz clic en un segmento para ver las pautas</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <DashboardCard>
        <ChartCardHeader
          title="Oportunidades creadas por tiempo y fuente (últimos 30 días)"
          total={oppsByDayRows.reduce(
            (s, r) => s + oppsByDayKeys.reduce((a, k) => a + ((r[k] as number) || 0), 0),
            0,
          )}
          icon={BarChart3}
        />
        <ChartCardContent>
          {oppsByDayKeys.length === 0 ? (
            <ChartEmpty message="Sin datos en los últimos 30 días." height={260} />
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  oppsByDayKeys.map((k, i) => [k, { label: k, color: CHART_PALETTE[i % CHART_PALETTE.length] }])
                )}
                className="aspect-auto"
                style={{ height: 280 }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={oppsByDayRows} margin={{ top: 5, right: 16, left: 8, bottom: 5 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 10, fill: CHART_TICK.fill }}
                      tickLine={false}
                      axisLine={false}
                      interval={4}
                    />
                    <YAxis
                      tick={{ ...CHART_TICK }}
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
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
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
              <ChartHint>Apilado por fuente del CRM · eje X cada 5 días</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <DashboardCard>
        <ChartCardHeader title="Pautas por Nombre (Top 30)" total={pautas.length} icon={FileText} />
        <ChartCardContent>
          {pautasByNombre.length === 0 ? (
            <ChartEmpty message="Sin datos de Pautas." height={380} />
          ) : (
            <>
              <ChartContainer config={{ count: { label: "Pautas", color: BRAND_AMBER } }} className="aspect-auto" style={{ height: 380 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pautasByNombre} margin={{ top: 5, right: 16, left: 8, bottom: 120 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                    <XAxis
                      dataKey="nombre"
                      type="category"
                      tick={{ fontSize: 10, fill: CHART_TICK.fill }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-45}
                      textAnchor="end"
                      tickFormatter={(v: string) => v.length > 28 ? v.slice(0, 28) + "…" : v}
                    />
                    <YAxis type="number" tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<NonZeroTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.nombre ?? String(_)} />} />
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
                        <Cell key={entry.nombre} fill={chartPaletteColor(i)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <ChartHint>Haz clic en una barra para ver las pautas</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <DashboardCard>
        <ChartCardHeader
          title="Oportunidades por Etapa del Pipeline"
          total={pautaByStageTotal}
          icon={Layers}
          actions={<GroupByToggle value={stageGroupBy} onChange={setStageGroupBy} />}
        />
        <ChartCardContent>
          {pautaByStageKeys.length === 0 ? (
            <ChartEmpty message="Sin oportunidades con datos de atribución." height={300} />
          ) : (
            <>
              <ChartContainer config={pautaByStageConfig} className="aspect-auto" style={{ height: 480 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pautaByStageRows} margin={{ top: 5, right: 16, left: 8, bottom: 140 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                    <XAxis
                      dataKey="stage"
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
                      wrapperStyle={{ fontSize: 10, paddingTop: 8, lineHeight: "16px" }}
                      iconSize={8}
                      formatter={(value: string) => (
                        <span
                          style={{ color: "#374151", marginRight: 4 }}
                          title={value}
                        >
                          {stageGroupBy === "url" ? paidTrafficUrlLabel(value) : value.slice(0, 20)}
                        </span>
                      )}
                    />
                    {pautaByStageKeys.map((key, i) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="a"
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        radius={i === pautaByStageKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        maxBarSize={56}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const count = data[key] as number
                          if (!count) return
                          const stage = data.stage as string
                          const items = opportunities.filter((o) => {
                            if (o.stage !== stage) return false
                            const rawKey = stageGroupBy === "url" ? o.attributionUrl : o.adId
                            return rawKey === key
                          })
                          const label = stageGroupBy === "url" ? paidTrafficUrlLabel(key) : key
                          openDrill(
                            `${label} · ${stage}`,
                            items,
                            `${items.length} oportunidad${items.length !== 1 ? "es" : ""} en ${stage}`
                          )
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <ChartHint>
                {`Apilado por ${stageGroupBy === "url" ? "URL de atribución" : "ID de anuncio"} · top 30 · haz clic en un segmento para ver las oportunidades`}
              </ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      {/* Panel 2 — Oportunidades por ID de Anuncio / Panel 3 — URLs por plataforma */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard>
          <ChartCardHeader
            title="Oportunidades por ID de Anuncio"
            total={leadsByAdId.reduce((s, e) => s + e.count, 0)}
            icon={Tag}
          />
          <ChartCardContent>
            {leadsByAdId.length === 0 ? (
              <ChartEmpty message="Sin datos de ID de anuncio." height={220} />
            ) : (
              <>
                <div className="overflow-auto max-h-[340px] rounded-md border border-border/40">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-xs">ID</TableHead>
                        <TableHead className="text-xs text-right"># de oportunidades</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leadsByAdId.map((entry) => (
                        <TableRow
                          key={entry.adId}
                          className="cursor-pointer"
                          onClick={() =>
                            openDrill(
                              `Ad ID: ${entry.adId}`,
                              opportunities.filter((o) => o.adId === entry.adId)
                            )
                          }
                        >
                          <TableCell className="font-mono text-xs text-foreground">
                            <span className="inline-flex items-center gap-0">
                              {entry.adId}
                              <CopyButton value={entry.adId} />
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold tabular-nums text-foreground">
                            {entry.count}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <ChartHint>Haz clic en una fila para ver las oportunidades</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>

        <DashboardCard>
          <ChartCardHeader
            title="Oportunidades por URL (Facebook / Instagram)"
            total={
              leadsByPlatformUrl.fb.reduce((s, e) => s + e.count, 0) +
              leadsByPlatformUrl.ig.reduce((s, e) => s + e.count, 0)
            }
            icon={BarChart3}
          />
          <ChartCardContent>
            {leadsByPlatformUrl.fb.length === 0 && leadsByPlatformUrl.ig.length === 0 ? (
              <ChartEmpty message="Sin datos de URL de Facebook o Instagram." height={220} />
            ) : (
              <>
                <div className="overflow-auto max-h-[340px] rounded-md border border-border/40">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <Facebook className="h-3.5 w-3.5 text-[#1877f2]" /> Facebook
                          </span>
                        </TableHead>
                        <TableHead className="text-xs text-right">#</TableHead>
                        <TableHead className="text-xs border-l border-border/40">
                          <span className="inline-flex items-center gap-1.5">
                            <Instagram className="h-3.5 w-3.5 text-[#e1306c]" /> Instagram
                          </span>
                        </TableHead>
                        <TableHead className="text-xs text-right">#</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.from({
                        length: Math.max(leadsByPlatformUrl.fb.length, leadsByPlatformUrl.ig.length),
                      }).map((_, i) => {
                        const fb = leadsByPlatformUrl.fb[i]
                        const ig = leadsByPlatformUrl.ig[i]
                        return (
                          <TableRow key={i} className="hover:bg-transparent">
                            {fb ? (
                              <>
                                <TableCell
                                  className="cursor-pointer font-mono text-xs text-foreground hover:text-primary"
                                  title={fb.url}
                                  onClick={() =>
                                    openDrill(
                                      `Facebook: ${fb.url}`,
                                      opportunities.filter((o) => o.attributionUrl === fb.url)
                                    )
                                  }
                                >
                                  <span className="inline-flex items-center gap-0">
                                    {shortUrlLabel(fb.url)}
                                    <CopyButton value={fb.url} />
                                  </span>
                                </TableCell>
                                <TableCell className="text-right text-sm font-semibold tabular-nums text-foreground">
                                  {fb.count}
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell />
                                <TableCell />
                              </>
                            )}
                            {ig ? (
                              <>
                                <TableCell
                                  className="cursor-pointer border-l border-border/40 font-mono text-xs text-foreground hover:text-primary"
                                  title={ig.url}
                                  onClick={() =>
                                    openDrill(
                                      `Instagram: ${ig.url}`,
                                      opportunities.filter((o) => o.attributionUrl === ig.url)
                                    )
                                  }
                                >
                                  <span className="inline-flex items-center gap-0">
                                    {shortUrlLabel(ig.url)}
                                    <CopyButton value={ig.url} />
                                  </span>
                                </TableCell>
                                <TableCell className="text-right text-sm font-semibold tabular-nums text-foreground">
                                  {ig.count}
                                </TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="border-l border-border/40" />
                                <TableCell />
                              </>
                            )}
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
                <ChartHint>Haz clic en una URL para ver las oportunidades</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>

      {/* Panel 4a — Tráfico Pagado con Cita / Panel 4b — Deals Ganados de Tráfico Pagado */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DashboardCard>
          <ChartCardHeader
            title="Leads de Tráfico Pagado con Cita"
            total={paidTrafficWithAppt.reduce((s, e) => s + e.count, 0)}
            icon={Calendar}
            actions={<GroupByToggle value={apptGroupBy} onChange={setApptGroupBy} />}
          />
          <ChartCardContent>
            {paidTrafficWithAppt.length === 0 ? (
              <ChartEmpty message="Sin leads de tráfico pagado con cita." height={220} />
            ) : (
              <>
                <ChartContainer
                  config={{ count: { label: "Con cita", color: BRAND_AMBER } }}
                  className="aspect-auto"
                  style={{ height: 300 }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={paidTrafficWithAppt}
                      margin={{ top: 16, right: 16, left: 8, bottom: 80 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                      <XAxis
                        dataKey="label"
                        tick={{ ...CHART_TICK }}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={-40}
                        textAnchor="end"
                      />
                      <YAxis tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <ChartTooltip
                        content={
                          <NonZeroTooltipContent
                            labelFormatter={(_: unknown, p: any) => p?.[0]?.payload?.rawKey ?? String(_)}
                          />
                        }
                      />
                      <Bar
                        dataKey="count"
                        radius={[6, 6, 0, 0]}
                        name="Con cita"
                        maxBarSize={48}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const rawKey = data.rawKey as string
                          const apptContactIds = new Set(appointments.map((a) => a.contactId))
                          openDrill(
                            `Tráfico pagado con cita: ${data.label}`,
                            opportunities.filter((o) => {
                              if (!isPaidTraffic(o) || !apptContactIds.has(o.contactId)) return false
                              return apptGroupBy === "url"
                                ? o.attributionUrl === rawKey
                                : o.adId === rawKey
                            })
                          )
                        }}
                      >
                        {paidTrafficWithAppt.map((entry, i) => (
                          <Cell key={entry.rawKey} fill={chartPaletteColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <ChartHint>Leads de paid social + paid search que tienen al menos una cita agendada</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>

        <DashboardCard>
          <ChartCardHeader
            title="Deals Ganados de Tráfico Pagado"
            total={wonPaidTraffic.reduce((s, e) => s + e.count, 0)}
            icon={TrendingUp}
            actions={<GroupByToggle value={wonGroupBy} onChange={setWonGroupBy} />}
          />
          <ChartCardContent>
            {wonPaidTraffic.length === 0 ? (
              <ChartEmpty message="Sin deals ganados de tráfico pagado." height={220} />
            ) : (
              <>
                <ChartContainer
                  config={{ count: { label: "Ganados", color: BRAND_AMBER } }}
                  className="aspect-auto"
                  style={{ height: 300 }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={wonPaidTraffic}
                      margin={{ top: 16, right: 16, left: 8, bottom: 80 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                      <XAxis
                        dataKey="label"
                        tick={{ ...CHART_TICK }}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        angle={-40}
                        textAnchor="end"
                      />
                      <YAxis tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <ChartTooltip
                        content={
                          <NonZeroTooltipContent
                            labelFormatter={(_: unknown, p: any) => {
                              const entry = p?.[0]?.payload
                              if (!entry) return String(_)
                              const val = entry.value as number
                              return val > 0
                                ? `${entry.rawKey} · $${val.toLocaleString("es-MX")}`
                                : entry.rawKey
                            }}
                          />
                        }
                      />
                      <Bar
                        dataKey="count"
                        radius={[6, 6, 0, 0]}
                        name="Ganados"
                        maxBarSize={48}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const rawKey = data.rawKey as string
                          openDrill(
                            `Ganados de tráfico pagado: ${data.label}`,
                            opportunities.filter((o) => {
                              if (!isPaidTraffic(o) || o.status !== "won") return false
                              return wonGroupBy === "url"
                                ? o.attributionUrl === rawKey
                                : o.adId === rawKey
                            })
                          )
                        }}
                      >
                        {wonPaidTraffic.map((entry, i) => (
                          <Cell key={entry.rawKey} fill={chartPaletteColor(i)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <ChartHint>Oportunidades ganadas (won) de paid social + paid search · tooltip muestra valor total</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>

      <DashboardCard>
        <ChartCardHeader
          title="Citas por Pauta (atribución URL)"
          total={apptsByPautaRows.reduce(
            (s, r) => s + apptsByPautaKeys.reduce((a, k) => a + ((r[k] as number) || 0), 0),
            0,
          )}
          icon={Calendar}
        />
        <ChartCardContent>
          {apptsByPautaKeys.length === 0 ? (
            <ChartEmpty message="Sin citas atribuidas por URL." height={300} />
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  apptsByPautaKeys.map((k, i) => [k, { label: k, color: CHART_PALETTE[i % CHART_PALETTE.length] }])
                )}
                className="aspect-auto"
                style={{ height: 300 }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={apptsByPautaRows}
                    margin={{ top: 5, right: 16, left: 8, bottom: 120 }}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                    <XAxis
                      dataKey="pauta"
                      tick={{ fontSize: 10, fill: CHART_TICK.fill }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-45}
                      textAnchor="end"
                      tickFormatter={(v: string) => shortPautaName(v)}
                    />
                    <YAxis
                      tick={{ ...CHART_TICK }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <ChartTooltip
                      content={
                        <NonZeroTooltipContent
                          labelFormatter={(_: unknown, p: any) => {
                            const name = p?.[0]?.payload?.pauta ?? String(_)
                            return shortPautaName(name)
                          }}
                        />
                      }
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      formatter={(value) => <span style={{ color: "#374151" }}>{value}</span>}
                    />
                    {apptsByPautaKeys.map((key, i) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="a"
                        fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                        radius={i === apptsByPautaKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        maxBarSize={40}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const count = data[key] as number
                          if (!count) return
                          const pautaName = data.pauta as string
                          const normUrl = extractPautaUrl(pautaName)
                          const matchedContactIds = new Set(
                            contacts
                              .filter((c) => c.attributionUrl && normalizeUrl(c.attributionUrl) === normUrl)
                              .map((c) => c.id)
                          )
                          const matchedContactIdsForStatus = new Set(
                            appointments
                              .filter(
                                (a) =>
                                  matchedContactIds.has(a.contactId) &&
                                  (a.status || "Sin estatus") === key,
                              )
                              .map((a) => a.contactId)
                          )
                          openDrill(
                            `${shortPautaName(pautaName)} · ${key}`,
                            opportunities.filter((o) => matchedContactIdsForStatus.has(o.contactId)),
                            `${count} cita${count !== 1 ? "s" : ""} con estatus "${key}"`,
                          )
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <ChartHint>Apilado por estatus · atribución vía URL · haz clic para ver oportunidades</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <ChartDrillDrawer
        drill={drill}
        onDrillChange={setDrill}
        contacts={contacts}
        tasks={tasks}
        calls={calls}
        allOpportunities={opportunities}
        allPautas={pautas}
        appointments={appointments}
        locationId={locationId}
        onAnalyzeWithAI={onAnalyzeWithAI}
      />
    </DashboardShell>
  )
}
