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
import type { Opportunity, Contact, Pauta, Task, Call, Appointment, Pipeline } from "@/lib/types"
import { Tag, FileText, Calendar, BarChart3, Layers, TrendingUp, TrendingDown, Facebook, Instagram, Copy, Check, ExternalLink } from "lucide-react"
import { ChartDrillDrawer, DRILL_CLOSED, type DrillState } from "./chart-drill-drawer"
import { OrigenDeLeadInfo } from "./origen-de-lead-criteria"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Spanish labels for raw GHL appointment statuses.
const APPT_STATUS_LABELS: Record<string, string> = {
  showed: "Asistió",
  confirmed: "Confirmada",
  new: "Pendiente",
  noshow: "No asistió",
  cancelled: "Cancelada",
  invalid: "Inválida",
}

const apptStatusLabel = (s: string) => APPT_STATUS_LABELS[s] ?? s

interface MarketingDashboardProps {
  opportunities: Opportunity[]
  contacts: Contact[]
  pautas: Pauta[]
  pipelines?: Pipeline[]
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

// CHART_PALETTE imported from dashboard-ui (amber-led)

const PLATFORM_COLORS: Record<string, string> = {
  "Instagram":  "#E1306C",
  "Facebook":   "#1877F2",
  "TikTok":     "#010101",
  "Google":     "#EA4335",
  "WhatsApp":   "#25D366",
  "Otro":       "#6b7280",
}

const PLATFORM_ORDER = ["Instagram", "Facebook", "TikTok", "Google", "WhatsApp", "Otro"]

function platformLabel(opp: Opportunity): string {
  const url  = (opp.attributionUrl ?? "").toLowerCase()
  const src  = (opp.source ?? "").toLowerCase()
  if (url.includes("instagram.com") || src.includes("instagram")) return "Instagram"
  if (
    url.includes("fb.me") || url.includes("facebook.com") || url.includes("fb.com") ||
    src.includes("facebook") || src.includes("meta") || src === "fb" ||
    /^\d{10,}$/.test(opp.source ?? "")
  ) return "Facebook"
  if (src.includes("tiktok")) return "TikTok"
  if (src.includes("google") || src.includes("bing") || src.includes("yahoo")) return "Google"
  const med = (opp.attributionMedium ?? "").toLowerCase()
  if (med === "whatsapp" || (opp.contact?.tags ?? []).some((t) => t.toLowerCase().includes("inbound whatsapp"))) return "WhatsApp"
  return "Otro"
}

const REINGRESO_LABELS = [
  "Primer ingreso",
  "Segundo reingreso",
  "Tercer reingreso",
  "Cuarto reingreso",
  "5to+ reingreso",
]

const REINGRESO_COLORS: Record<string, string> = {
  "Primer ingreso":    "#3b82f6",
  "Segundo reingreso": "#f59e0b",
  "Tercer reingreso":  "#10b981",
  "Cuarto reingreso":  "#8b5cf6",
  "5to+ reingreso":    "#ef4444",
}

function reingresoLabel(zeroBasedIndex: number): string {
  return REINGRESO_LABELS[Math.min(zeroBasedIndex, REINGRESO_LABELS.length - 1)]
}


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

const SOCIAL_ORGANIC_SOURCES = ["instagram", "facebook", "twitter", "linkedin", "youtube", "tiktok", "pinterest", "social_media", "social media", "organic_social"]

const SOURCE_CATEGORY_ORDER = ["Paid Social", "Paid Search", "Social Media", "CRM UI", "Orgánico Web", "Otro"]
const SOURCE_CATEGORY_COLORS: Record<string, string> = {
  "Paid Social":   "#3b82f6",
  "Paid Search":   "#0891b2",
  "Social Media":  "#8b5cf6",
  "CRM UI":        "#f59e0b",
  "Orgánico Web":  "#10b981",
  "Otro":          "#6b7280",
}

function sourceCategory(opp: Opportunity): string {
  const src = (opp.source ?? "").toLowerCase()
  const med = (opp.adType ?? "").toLowerCase()
  if (PAID_SOCIAL_SOURCES.some((s) => src.includes(s)) || PAID_SOCIAL_MEDIUMS.some((m) => med.includes(m))) return "Paid Social"
  if (PAID_SEARCH_SOURCES.some((s) => src.includes(s)) || PAID_SEARCH_MEDIUMS.some((m) => med.includes(m))) return "Paid Search"
  if (SOCIAL_ORGANIC_SOURCES.some((s) => src.includes(s)) || med.includes("social")) return "Social Media"
  if (src === "" || src === "crm" || src === "crm ui" || src === "manual" || med === "" ) return "CRM UI"
  if (src.includes("web") || src.includes("website") || src.includes("landing") || med === "organic" || med === "referral") return "Orgánico Web"
  return "Otro"
}

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

// Contact-side counterpart of platformLabel(opp): map a contact's attribution
// to the social platform it originated from. GHL stores the click-through URL
// on each attribution (instagram.com/…, fb.me/…, tiktok.com/…); unknown/absent
// signals fall back to "Otro".
function platformFromContact(c?: Contact): string {
  const url = (c?.attributionUrl ?? "").toLowerCase()
  const src = (c?.source ?? "").toLowerCase()
  if (url.includes("instagram.com") || src.includes("instagram")) return "Instagram"
  if (
    url.includes("fb.me") || url.includes("facebook.com") || url.includes("fb.com") ||
    src.includes("facebook") || src.includes("meta") || src === "fb" ||
    /^\d{10,}$/.test(c?.source ?? "")
  ) return "Facebook"
  if (url.includes("tiktok") || src.includes("tiktok")) return "TikTok"
  if (src.includes("google") || src.includes("bing") || src.includes("yahoo")) return "Google"
  const med = (c?.attributionMedium ?? "").toLowerCase()
  if (med === "whatsapp" || (c?.tags ?? []).some((t) => t.toLowerCase().includes("inbound whatsapp"))) return "WhatsApp"
  return "Otro"
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

function LinkButton({ value }: { value: string }) {
  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-1.5 inline-flex shrink-0 items-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
      title={value}
      onClick={(e) => e.stopPropagation()}
    >
      <ExternalLink className="h-3 w-3" />
    </a>
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

type OriginGroupBy = "platform" | "id" | "url"

const ORIGIN_GROUP_OPTIONS: { value: OriginGroupBy; label: string; column: string }[] = [
  { value: "platform", label: "Plataforma", column: "Plataforma" },
  { value: "id",       label: "ID Pauta",   column: "ID de Pauta" },
  { value: "url",      label: "URL Pauta",  column: "URL de Pauta" },
]

function OriginGroupByToggle({ value, onChange }: { value: OriginGroupBy; onChange: (v: OriginGroupBy) => void }) {
  return (
    <div className="flex items-center overflow-hidden rounded border border-border/50 text-[10px] font-medium">
      {ORIGIN_GROUP_OPTIONS.map((opt, i) => (
        <button
          key={opt.value}
          onClick={(e) => { e.stopPropagation(); onChange(opt.value) }}
          className={[
            "px-2 py-0.5 transition-colors uppercase tracking-wide",
            i > 0 ? "border-l border-border/50" : "",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function TopNSlider({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const effectiveValue = Math.min(value, max)
  const isAll = effectiveValue >= max
  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] font-medium text-muted-foreground tabular-nums w-12 text-right shrink-0">
        {isAll ? "Todo" : `Top ${effectiveValue}`}
      </span>
      <input
        type="range"
        min={1}
        max={max || 1}
        value={effectiveValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-20 cursor-pointer accent-primary"
      />
    </div>
  )
}

export function MarketingDashboard({ opportunities, contacts, pautas, pipelines = [], tasks = [], calls = [], appointments = [], locationId = "", onAnalyzeWithAI }: MarketingDashboardProps) {
  const [drill, setDrill] = useState<DrillState>(DRILL_CLOSED)
  const [hoveredAdType, setHoveredAdType] = useState<number | undefined>(undefined)
  const [apptGroupBy, setApptGroupBy] = useState<PaidGroupBy>("url")
  const [wonGroupBy, setWonGroupBy] = useState<PaidGroupBy>("url")
  const [stageGroupBy, setStageGroupBy] = useState<PaidGroupBy>("url")
  const [lostGroupBy, setLostGroupBy] = useState<PaidGroupBy>("url")
  const [originGroupBy, setOriginGroupBy] = useState<OriginGroupBy>("platform")
  const [onlyReingresos, setOnlyReingresos] = useState(false)
  const [pautaUniqueLeads, setPautaUniqueLeads] = useState(false)
  const [stageTopN, setStageTopN] = useState(30)
  const [lostTopN, setLostTopN] = useState(30)
  const [apptTopN, setApptTopN] = useState(Infinity)
  const [wonTopN, setWonTopN] = useState(Infinity)
  const [apptStatusFilter, setApptStatusFilter] = useState<string>("all")

  const openDrill = useCallback((title: string, items: Opportunity[], subtitle?: string) => {
    setDrill({ open: true, title, subtitle, opportunities: items })
  }, [])

  // Drill to the contacts (leads) behind a set of pautas. Resolving to
  // opportunities here would drastically undercount, since most pauta contacts
  // never become opportunities — the drawer count must track the bar's count.
  const openPautaDrill = useCallback((title: string, pautaItems: Pauta[]) => {
    const contactIds = new Set(pautaItems.map(p => p.contactId).filter((id): id is string => Boolean(id)))
    const contactItems = contacts.filter(c => contactIds.has(c.id))
    setDrill({ open: true, title, opportunities: [], contactItems })
  }, [contacts])

  // Derive ordered stage list using GHL pipeline order; fall back to alphabetical for unlisted stages
  const stageOrder = useMemo(() => {
    const actual = new Set(opportunities.map((o) => o.stage))
    const ordered: string[] = []
    // Walk pipelines in their GHL-defined stage order
    for (const p of pipelines) {
      for (const s of p.stages) {
        if (actual.has(s) && !ordered.includes(s)) ordered.push(s)
      }
    }
    // Append any stages present in data but not covered by pipeline definitions
    for (const s of actual) if (!ordered.includes(s)) ordered.push(s)
    return ordered
  }, [opportunities, pipelines])

  // Leads por Plataforma — ALL opportunities, stacked by source category
  const leadsByCategory = useMemo(() => {
    // platform → sourceCategory → count
    const platMap = new Map<string, Map<string, number>>()
    for (const o of opportunities) {
      const plat = platformLabel(o)
      const cat = sourceCategory(o)
      if (!platMap.has(plat)) platMap.set(plat, new Map())
      const catCounts = platMap.get(plat)!
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1)
    }
    return Array.from(platMap.entries())
      .map(([platform, catCounts]) => {
        const breakdown = SOURCE_CATEGORY_ORDER
          .filter((cat) => catCounts.has(cat))
          .map((cat) => ({ category: cat, count: catCounts.get(cat)!, color: SOURCE_CATEGORY_COLORS[cat] ?? "#6b7280" }))
        const total = breakdown.reduce((s, e) => s + e.count, 0)
        return { platform, total, color: PLATFORM_COLORS[platform] ?? "#6b7280", breakdown }
      })
      .sort((a, b) => b.total - a.total)
  }, [opportunities])

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>()
    for (const c of contacts) m.set(c.id, c)
    return m
  }, [contacts])

  // Pautas por canal (tipo) apiladas por plataforma de origen del contacto.
  // pautaUniqueLeads === true counts distinct contacts per tipo×platform (so the
  // tooltip matches the drill drawer exactly); otherwise it counts pauta records.
  const { pautasByTipoRows, pautasByTipoPlatforms, pautasByTipoTotal } = useMemo(() => {
    const byTipo = new Map<string, Map<string, number>>()
    const platformTotals = new Map<string, number>()

    if (pautaUniqueLeads) {
      // tipo|platform → distinct contactIds
      const cells = new Map<string, Map<string, Set<string>>>()
      const perPlatform = new Map<string, Set<string>>()
      for (const p of pautas) {
        if (!p.contactId) continue
        const platform = platformFromContact(contactById.get(p.contactId))
        if (!cells.has(p.tipo)) cells.set(p.tipo, new Map())
        const byPlatform = cells.get(p.tipo)!
        if (!byPlatform.has(platform)) byPlatform.set(platform, new Set())
        byPlatform.get(platform)!.add(p.contactId)
        if (!perPlatform.has(platform)) perPlatform.set(platform, new Set())
        perPlatform.get(platform)!.add(p.contactId)
      }
      for (const [tipo, byPlatform] of cells) {
        const m = new Map<string, number>()
        for (const [platform, ids] of byPlatform) m.set(platform, ids.size)
        byTipo.set(tipo, m)
      }
      for (const [platform, ids] of perPlatform) platformTotals.set(platform, ids.size)
    } else {
      for (const p of pautas) {
        const platform = platformFromContact(p.contactId ? contactById.get(p.contactId) : undefined)
        if (!byTipo.has(p.tipo)) byTipo.set(p.tipo, new Map())
        const m = byTipo.get(p.tipo)!
        m.set(platform, (m.get(platform) ?? 0) + 1)
        platformTotals.set(platform, (platformTotals.get(platform) ?? 0) + 1)
      }
    }

    // Standardized "Origen de lead" legend: always present the full canonical
    // platform order, including zero-count platforms, so the legend is identical
    // across charts regardless of which platforms appear in the data.
    const platforms = [...PLATFORM_ORDER]
    const sumRow = (r: Record<string, string | number>) => platforms.reduce((s, k) => s + (r[k] as number), 0)
    const rows = Array.from(byTipo.entries())
      .map(([tipo, m]) => {
        const row: Record<string, string | number> = { tipo }
        for (const k of platforms) row[k] = m.get(k) ?? 0
        return row
      })
      .sort((a, b) => sumRow(b) - sumRow(a))
    const pautasByTipoTotal = rows.reduce((s, r) => s + sumRow(r), 0)
    return { pautasByTipoRows: rows, pautasByTipoPlatforms: platforms, pautasByTipoTotal }
  }, [pautas, contactById, pautaUniqueLeads])

  // Attribution (URL or Ad ID) × Etapa del Pipeline (stacked bar: X = stage, Y = opp count, color = attribution key).
  const { pautaByStageRows, pautaByStageKeys, pautaByStageKeyCount } = useMemo(() => {
    const totals = new Map<string, number>()
    const perStage = new Map<string, Map<string, number>>()
    for (const stage of stageOrder) perStage.set(stage, new Map())

    for (const opp of opportunities) {
      if (opp.status === "lost") continue
      const rawKey = stageGroupBy === "url" ? opp.attributionUrl : opp.adId
      if (!rawKey) continue
      const stageMap = perStage.get(opp.stage)
      if (!stageMap) continue
      stageMap.set(rawKey, (stageMap.get(rawKey) ?? 0) + 1)
      totals.set(rawKey, (totals.get(rawKey) ?? 0) + 1)
    }

    const allKeys = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
    const pautaByStageKeyCount = allKeys.length
    const keys = stageTopN >= pautaByStageKeyCount ? allKeys : allKeys.slice(0, Math.round(stageTopN))

    const rows = stageOrder
      .map((stage) => {
        const row: Record<string, string | number> = { stage }
        const stageMap = perStage.get(stage)!
        for (const k of keys) row[k] = stageMap.get(k) ?? 0
        return row
      })
      .filter((row) => keys.some((k) => (row[k] as number) > 0))

    return { pautaByStageRows: rows, pautaByStageKeys: keys, pautaByStageKeyCount }
  }, [opportunities, stageOrder, stageGroupBy, stageTopN])

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

  const { lostByReasonRows, lostByReasonKeys, lostByReasonKeyCount } = useMemo(() => {
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

    const allKeys = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
    const lostByReasonKeyCount = allKeys.length
    const keys = lostTopN >= lostByReasonKeyCount ? allKeys : allKeys.slice(0, Math.round(lostTopN))

    const reasons = Array.from(perReason.keys()).sort()

    const rows = reasons
      .map((reason) => {
        const row: Record<string, string | number> = { reason }
        const reasonMap = perReason.get(reason)!
        for (const k of keys) row[k] = reasonMap.get(k) ?? 0
        return row
      })
      .filter((row) => keys.some((k) => (row[k] as number) > 0))

    return { lostByReasonRows: rows, lostByReasonKeys: keys, lostByReasonKeyCount }
  }, [opportunities, lostGroupBy, lostTopN])

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

  // Map pauta.id → reingresoLabel by sorting each contact's pautas chronologically.
  const pautaReingresoMap = useMemo(() => {
    const byContact = new Map<string, Pauta[]>()
    for (const p of pautas) {
      if (!p.contactId) continue
      const arr = byContact.get(p.contactId) ?? []
      arr.push(p)
      byContact.set(p.contactId, arr)
    }
    const result = new Map<string, string>()
    for (const arr of byContact.values()) {
      arr.sort((a, b) => toUTCDateStr(a.createdAt).localeCompare(toUTCDateStr(b.createdAt)))
      arr.forEach((p, i) => result.set(p.id, reingresoLabel(i)))
    }
    return result
  }, [pautas])

  const reingresoCount = useMemo(
    () => Array.from(pautaReingresoMap.values()).filter((v) => v !== "Primer ingreso").length,
    [pautaReingresoMap]
  )

  // Pautas grouped by calendar month (YYYY-MM), stacked by reingreso number.
  const { pautasByMonthRows, pautasByMonthKeys } = useMemo(() => {
    if (pautas.length === 0) return { pautasByMonthRows: [], pautasByMonthKeys: [] }

    const byMonth = new Map<string, Map<string, number>>()
    const reingresoTotals = new Map<string, number>()

    for (const p of pautas) {
      if (!p.contactId) continue
      const dateStr = toUTCDateStr(p.createdAt)
      if (!dateStr) continue
      const monthKey = dateStr.slice(0, 7)
      const reingreso = pautaReingresoMap.get(p.id) ?? "Primer ingreso"

      if (!byMonth.has(monthKey)) byMonth.set(monthKey, new Map())
      const m = byMonth.get(monthKey)!
      m.set(reingreso, (m.get(reingreso) ?? 0) + 1)
      reingresoTotals.set(reingreso, (reingresoTotals.get(reingreso) ?? 0) + 1)
    }

    // Keep keys in canonical REINGRESO_LABELS order (only those with data)
    const keys = REINGRESO_LABELS.filter((k) => reingresoTotals.has(k))

    const sortedMonths = Array.from(byMonth.keys()).sort()

    const rows = sortedMonths.map((monthKey) => {
      const label = new Date(monthKey + "-15T12:00:00Z")
        .toLocaleDateString("es-MX", { month: "short", year: "2-digit" })
      const row: Record<string, string | number> = { monthKey, monthLabel: label }
      const m = byMonth.get(monthKey)!
      for (const k of keys) row[k] = m.get(k) ?? 0
      return row
    })

    return { pautasByMonthRows: rows, pautasByMonthKeys: keys }
  }, [pautas, pautaReingresoMap])

  const paidSocialLeadCount = useMemo(
    () => opportunities.filter((o) => isPaidSocial(o)).length,
    [opportunities],
  )

  // Table 1: group all opportunities by their GHL source field (normalized)
  // source is the manually-set field in GHL — "tiktok", "Sitio Web", "Referido", numeric FB IDs, etc.
  // Single "Rendimiento por origen" table: group opportunities by platform,
  // Ad ID, or attribution URL (3-way toggle). In id/url modes opps without a
  // pauta are excluded; platform mode keeps everything (falls back to "Otro").
  const originRows = useMemo(() => {
    const map = new Map<string, Opportunity[]>()
    for (const o of opportunities) {
      let key: string | null
      if (originGroupBy === "platform") key = platformLabel(o)
      else if (originGroupBy === "id") key = o.adId || null
      else key = o.attributionUrl || null
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(o)
    }
    return Array.from(map.entries())
      .map(([key, opps]) => {
        const wonOpps = opps.filter((o) => o.status === "won")
        const wonValue = wonOpps.reduce((s, o) => s + o.value, 0)
        return {
          key,
          label: originGroupBy === "url" ? paidTrafficUrlLabel(key) : key,
          total: opps.length,
          wonCount: wonOpps.length,
          wonValue,
          closeRate: opps.length > 0 ? (wonOpps.length / opps.length) * 100 : 0,
          avgTicket: wonOpps.length > 0 ? wonValue / wonOpps.length : 0,
          opps,
        }
      })
      .sort((a, b) => b.wonCount - a.wonCount || b.total - a.total)
  }, [opportunities, originGroupBy])

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

  const apptStatuses = useMemo(() => {
    const s = new Set(appointments.map((a) => a.status).filter(Boolean))
    return Array.from(s).sort()
  }, [appointments])

  // Panel 4a — Paid traffic leads with at least one appointment
  const { paidTrafficWithAppt, apptKeyCount } = useMemo(() => {
    const filteredAppts = apptStatusFilter === "all"
      ? appointments
      : appointments.filter((a) => a.status === apptStatusFilter)
    const apptContactIds = new Set(filteredAppts.map((a) => a.contactId))
    const counts = new Map<string, number>()
    for (const o of opportunities) {
      if (!isPaidTraffic(o)) continue
      if (!apptContactIds.has(o.contactId)) continue
      const rawKey = apptGroupBy === "url" ? o.attributionUrl : o.adId
      if (!rawKey) continue
      counts.set(rawKey, (counts.get(rawKey) ?? 0) + 1)
    }
    const allEntries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
    const apptKeyCount = allEntries.length
    const sliced = apptTopN >= apptKeyCount ? allEntries : allEntries.slice(0, Math.round(apptTopN))
    return {
      paidTrafficWithAppt: sliced.map(([rawKey, count]) => ({
        rawKey,
        label: apptGroupBy === "url" ? paidTrafficUrlLabel(rawKey) : rawKey,
        count,
      })),
      apptKeyCount,
    }
  }, [opportunities, appointments, apptGroupBy, apptTopN, apptStatusFilter])

  // Panel 4b — Won deals from paid traffic, grouped by URL or Ad ID
  const { wonPaidTraffic, wonKeyCount } = useMemo(() => {
    const counts = new Map<string, { count: number; value: number }>()
    for (const o of opportunities) {
      if (!isPaidTraffic(o) || o.status !== "won") continue
      const rawKey = wonGroupBy === "url" ? o.attributionUrl : o.adId
      if (!rawKey) continue
      const prev = counts.get(rawKey) ?? { count: 0, value: 0 }
      counts.set(rawKey, { count: prev.count + 1, value: prev.value + o.value })
    }
    const allEntries = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count)
    const wonKeyCount = allEntries.length
    const sliced = wonTopN >= wonKeyCount ? allEntries : allEntries.slice(0, Math.round(wonTopN))
    return {
      wonPaidTraffic: sliced.map(([rawKey, { count, value }]) => ({
        rawKey,
        label: wonGroupBy === "url" ? paidTrafficUrlLabel(rawKey) : rawKey,
        count,
        value,
      })),
      wonKeyCount,
    }
  }, [opportunities, wonGroupBy, wonTopN])

  // Won opportunities: bars by the standardized "Origen de lead" platform
  // (full PLATFORM_ORDER on the x-axis), stacked by Fuente de creación segments
  // (SOURCE_CATEGORY_ORDER) — same two dimensions as "Oportunidades por fuente".
  const wonBySource = useMemo(() => {
    const byPlatform = new Map<string, Map<string, number>>()
    for (const o of opportunities) {
      if (o.status !== "won") continue
      const platform = platformLabel(o)
      const cat = sourceCategory(o)
      if (!byPlatform.has(platform)) byPlatform.set(platform, new Map())
      const m = byPlatform.get(platform)!
      m.set(cat, (m.get(cat) ?? 0) + 1)
    }
    return PLATFORM_ORDER.map((platform) => {
      const m = byPlatform.get(platform) ?? new Map<string, number>()
      const row: Record<string, string | number> = { platform }
      for (const cat of SOURCE_CATEGORY_ORDER) row[cat] = m.get(cat) ?? 0
      return row
    })
  }, [opportunities])

  const wonTotal = useMemo(
    () => opportunities.reduce((s, o) => (o.status === "won" ? s + 1 : s), 0),
    [opportunities],
  )

  return (
    <DashboardShell>
      <MarketingSummaryStrip
        opportunities={opportunities.length}
        pautas={pautas.length}
        uniquePautas={pautas.length - reingresoCount}
        reingresoPautas={reingresoCount}
        paidSocialLeads={paidSocialLeadCount}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
     
        <DashboardCard>
          <ChartCardHeader
            title="Oportunidades por fuente"
            total={opportunities.length}
            icon={Tag}
            actions={<OrigenDeLeadInfo />}
          />
          <ChartCardContent>
            {leadsByCategory.length === 0 ? (
              <ChartEmpty message="Sin datos de fuente." height={200} />
            ) : (() => {
              const total = opportunities.length
              const maxVal = Math.max(...leadsByCategory.map((e) => e.total))
              // Donut — one slice per platform
              const donutData = leadsByCategory.map((e) => ({ name: e.platform, value: e.total, color: e.color }))
              return (
                <div className="flex items-center gap-4">
                  {/* Donut */}
                  <div style={{ width: 160, height: 200, flexShrink: 0, position: "relative" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={72}
                          dataKey="value"
                          nameKey="name"
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
                          {donutData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
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

                  {/* Stacked bar list — one row per platform, segments = source category */}
                  <div className="flex flex-1 flex-col gap-y-3">
                    {leadsByCategory.map((entry, i) => {
                      const pct = total > 0 ? Math.round((entry.total / total) * 100) : 0
                      const barWidth = maxVal > 0 ? (entry.total / maxVal) * 100 : 0
                      return (
                        <div
                          key={entry.platform}
                          className="cursor-pointer rounded px-1 py-0.5 -mx-1 hover:bg-accent/20 transition-colors"
                          onClick={() =>
                            openDrill(
                              `Plataforma: ${entry.platform}`,
                              opportunities.filter((o) => platformLabel(o) === entry.platform)
                            )
                          }
                          onMouseEnter={() => setHoveredAdType(i)}
                          onMouseLeave={() => setHoveredAdType(undefined)}
                        >
                          <div className="flex items-baseline justify-between mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="inline-block h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: entry.color }}
                              />
                              <span className="text-xs text-foreground truncate">{entry.platform}</span>
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums ml-2 shrink-0">
                              {entry.total} · {pct}%
                            </span>
                          </div>
                          {/* Stacked bar — segments per source category, each individually clickable */}
                          <div className="h-2 rounded bg-muted overflow-hidden flex" style={{ width: `${barWidth}%` }}>
                            {entry.breakdown.map((seg) => (
                              <div
                                key={seg.category}
                                title={`${seg.category}: ${seg.count}`}
                                className="cursor-pointer hover:brightness-125 transition-[filter]"
                                style={{
                                  width: `${entry.total > 0 ? (seg.count / entry.total) * 100 : 0}%`,
                                  backgroundColor: seg.color,
                                  minWidth: seg.count > 0 ? 2 : 0,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openDrill(
                                    `${entry.platform} · ${seg.category}`,
                                    opportunities.filter(
                                      (o) => platformLabel(o) === entry.platform && sourceCategory(o) === seg.category
                                    )
                                  )
                                }}
                              />
                            ))}
                          </div>
                          {/* Category legend — only if more than one category; pills are clickable */}
                          {entry.breakdown.length > 1 && (
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                              {entry.breakdown.map((seg) => (
                                <button
                                  key={seg.category}
                                  type="button"
                                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-accent/30 px-0.5"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openDrill(
                                      `${entry.platform} · ${seg.category}`,
                                      opportunities.filter(
                                        (o) => platformLabel(o) === entry.platform && sourceCategory(o) === seg.category
                                      )
                                    )
                                  }}
                                >
                                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: seg.color }} />
                                  {seg.category} {seg.count}
                                </button>
                              ))}
                            </div>
                          )}
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
          <ChartCardHeader
            title="Pautas por canal de contacto"
            total={pautasByTipoTotal}
            icon={FileText}
            actions={
              <div className="flex items-center gap-2">
                <OrigenDeLeadInfo />
                <button
                  onClick={() => setPautaUniqueLeads((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                >
                  Leads únicos
                  <span className={`relative inline-flex h-3.5 w-6 shrink-0 rounded-full transition-colors duration-200 ${pautaUniqueLeads ? "bg-amber-500" : "bg-muted-foreground/30"}`}>
                    <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-transform duration-200 ${pautaUniqueLeads ? "translate-x-2.5" : "translate-x-0.5"}`} />
                  </span>
                </button>
              </div>
            }
          />
          <ChartCardContent>
            {pautasByTipoRows.length === 0 ? (
              <ChartEmpty message="Sin datos de Pautas." height={220} />
            ) : (
              <>
                <ChartContainer
                  config={Object.fromEntries(
                    pautasByTipoPlatforms.map((k) => [k, { label: k, color: PLATFORM_COLORS[k] ?? BRAND_AMBER }])
                  )}
                  className="aspect-auto"
                  style={{ height: 300 }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pautasByTipoRows} margin={{ top: 5, right: 8, left: 8, bottom: 70 }} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                      <XAxis dataKey="tipo" tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} interval={0} angle={-40} textAnchor="end" tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 20) + "…" : v} />
                      <YAxis tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <ChartTooltip content={<NonZeroTooltipContent labelFormatter={(_, p) => p?.[0]?.payload?.tipo ?? String(_)} />} />
                      <Legend
                        wrapperStyle={{ fontSize: 11, paddingTop: 0 }}
                        formatter={(value) => <span style={{ color: "#374151" }}>{value}</span>}
                      />
                      {pautasByTipoPlatforms.map((key, i) => (
                        <Bar
                          key={key}
                          dataKey={key}
                          stackId="a"
                          fill={PLATFORM_COLORS[key] ?? BRAND_AMBER}
                          radius={i === pautasByTipoPlatforms.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                          maxBarSize={48}
                          cursor="pointer"
                          onClick={(data: any) => {
                            const count = data[key] as number
                            if (!count) return
                            openPautaDrill(
                              `${data.tipo} · ${key}`,
                              pautas.filter(
                                (p) =>
                                  p.tipo === data.tipo &&
                                  platformFromContact(p.contactId ? contactById.get(p.contactId) : undefined) === key
                              )
                            )
                          }}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
                <ChartHint>{`Apilado por plataforma de origen del contacto · ${pautaUniqueLeads ? "leads únicos" : "pautas"} · haz clic en un segmento para ver los contactos`}</ChartHint>
              </>
            )}
          </ChartCardContent>
        </DashboardCard>
      </div>

      <DashboardCard>
        <ChartCardHeader
          title="Pautas creadas por mes y reingresos"
          total={pautas.length}
          icon={Calendar}
          actions={
            <>
              <button
                onClick={() => setOnlyReingresos((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground hover:text-foreground transition-colors"
              >
                Solo reingresos
                <span className={`relative inline-flex h-3.5 w-6 shrink-0 rounded-full transition-colors duration-200 ${onlyReingresos ? "bg-amber-500" : "bg-muted-foreground/30"}`}>
                  <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow transition-transform duration-200 ${onlyReingresos ? "translate-x-2.5" : "translate-x-0.5"}`} />
                </span>
              </button>
              <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium tabular-nums tracking-wide text-muted-foreground">
                Reingresos: {reingresoCount.toLocaleString("es-MX")}
              </span>
            </>
          }
        />
        <ChartCardContent>
          {pautasByMonthKeys.length === 0 ? (
            <ChartEmpty message="Sin datos de Pautas." height={280} />
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  pautasByMonthKeys.map((k) => [k, { label: k, color: REINGRESO_COLORS[k] ?? BRAND_AMBER }])
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
                    {(() => {
                      const visibleKeys = pautasByMonthKeys.filter((k) => !onlyReingresos || k !== "Primer ingreso")
                      return visibleKeys.map((key, i) => (
                        <Bar
                          key={key}
                          dataKey={key}
                          stackId="a"
                          fill={REINGRESO_COLORS[key] ?? BRAND_AMBER}
                          radius={i === visibleKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                          maxBarSize={40}
                          cursor="pointer"
                          onClick={(data: any) => {
                            const count = data[key] as number
                            if (!count) return
                            const monthKey = data.monthKey as string
                            const monthLabel = data.monthLabel as string
                            const matchedPautas = pautas.filter(
                              (p) =>
                                p.contactId &&
                                toUTCDateStr(p.createdAt).slice(0, 7) === monthKey &&
                                pautaReingresoMap.get(p.id) === key
                            )
                            const contactIds = new Set(matchedPautas.map((p) => p.contactId))
                            const contactItems = contacts.filter((c) => contactIds.has(c.id))
                            setDrill({ open: true, title: `${key} · ${monthLabel}`, opportunities: [], contactItems })
                          }}
                        />
                      ))
                    })()}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <ChartHint>Apilado por número de reingreso del contacto · haz clic en un segmento para ver las pautas</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <DashboardCard>
        <ChartCardHeader
          title="Oportunidades de Pauta por Etapa del Pipeline (Sin oportunidades perdidas)"
          total={pautaByStageTotal}
          icon={Layers}
          actions={
            <div className="flex items-center gap-2">
              <TopNSlider value={stageTopN} max={pautaByStageKeyCount} onChange={setStageTopN} />
              <GroupByToggle value={stageGroupBy} onChange={setStageGroupBy} />
            </div>
          }
        />
        <ChartCardContent>
          {pautaByStageKeys.length === 0 ? (
            <ChartEmpty message="Sin oportunidades con datos de atribución." height={300} />
          ) : (
            <>
              <ChartContainer config={pautaByStageConfig} className="aspect-auto" style={{ height: 480 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pautaByStageRows} margin={{ top: 5, right: 16, left: 8, bottom: 16 }} barCategoryGap="20%">
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
                      wrapperStyle={{ fontSize: 10, paddingTop: 48, lineHeight: "36px" }}
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
                {`Apilado por ${stageGroupBy === "url" ? "URL de atribución" : "ID de anuncio"} · ${stageTopN >= pautaByStageKeyCount ? "todo" : `top ${stageTopN}`} · haz clic en un segmento para ver las oportunidades`}
              </ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>

      <DashboardCard>
        <ChartCardHeader
          title="Oportunidades Perdidas por Razón de Pérdida"
          total={lostByReasonTotal}
          icon={TrendingDown}
          actions={
            <div className="flex items-center gap-2">
              <TopNSlider value={lostTopN} max={lostByReasonKeyCount} onChange={setLostTopN} />
              <GroupByToggle value={lostGroupBy} onChange={setLostGroupBy} />
            </div>
          }
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
                {`Apilado por ${lostGroupBy === "url" ? "URL de atribución" : "ID de anuncio"} · ${lostTopN >= lostByReasonKeyCount ? "todo" : `top ${lostTopN}`} · haz clic en un segmento para ver las oportunidades`}
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
                                    <LinkButton value={fb.url} />
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
                                    <LinkButton value={ig.url} />
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-1">
        <DashboardCard>
          <ChartCardHeader
            title="Citas por pauta"
            total={paidTrafficWithAppt.reduce((s, e) => s + e.count, 0)}
            icon={Calendar}
            actions={
              <div className="flex items-center gap-2">
                {apptStatuses.length > 0 && (
                  <Select value={apptStatusFilter} onValueChange={setApptStatusFilter}>
                    <SelectTrigger
                      className="h-7 w-[150px] text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <SelectValue placeholder="Todos los estatus" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos los estatus</SelectItem>
                      {apptStatuses.map((s) => (
                        <SelectItem key={s} value={s}>{apptStatusLabel(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <TopNSlider value={apptTopN} max={apptKeyCount} onChange={setApptTopN} />
                <GroupByToggle value={apptGroupBy} onChange={setApptGroupBy} />
              </div>
            }
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
                          // Mirror the bar's status filter so the drawer count tracks the bar.
                          const filteredAppts = apptStatusFilter === "all"
                            ? appointments
                            : appointments.filter((a) => a.status === apptStatusFilter)
                          const apptContactIds = new Set(filteredAppts.map((a) => a.contactId))
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
      </div>



      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <DashboardCard>
          <ChartCardHeader
            title="Oportunidades ganadas por pauta"
            total={wonPaidTraffic.reduce((s, e) => s + e.count, 0)}
            icon={TrendingUp}
            actions={
              <div className="flex items-center gap-2">
                <TopNSlider value={wonTopN} max={wonKeyCount} onChange={setWonTopN} />
                <GroupByToggle value={wonGroupBy} onChange={setWonGroupBy} />
              </div>
            }
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
      <DashboardCard>
        <ChartCardHeader
          title="Oportunidades Ganadas por Fuente"
          total={wonTotal}
          icon={TrendingUp}
          actions={<OrigenDeLeadInfo />}
        />
        <ChartCardContent>
          {wonTotal === 0 ? (
            <ChartEmpty message="Sin oportunidades ganadas." height={220} />
          ) : (
            <>
              <ChartContainer
                config={Object.fromEntries(
                  SOURCE_CATEGORY_ORDER.map((k) => [k, { label: k, color: SOURCE_CATEGORY_COLORS[k] ?? BRAND_AMBER }])
                )}
                className="aspect-auto"
                style={{ height: 300 }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={wonBySource} margin={{ top: 16, right: 16, left: 8, bottom: 80 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID_STROKE} />
                    <XAxis
                      dataKey="platform"
                      tick={{ ...CHART_TICK }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-40}
                      textAnchor="end"
                      tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 20) + "…" : v}
                    />
                    <YAxis tick={{ ...CHART_TICK }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<NonZeroTooltipContent labelFormatter={(_: unknown, p: any) => p?.[0]?.payload?.platform ?? String(_)} />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 0 }}
                      formatter={(value) => <span style={{ color: "#374151" }}>{value}</span>}
                    />
                    {SOURCE_CATEGORY_ORDER.map((key, i) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        stackId="a"
                        fill={SOURCE_CATEGORY_COLORS[key] ?? BRAND_AMBER}
                        radius={i === SOURCE_CATEGORY_ORDER.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                        maxBarSize={48}
                        cursor="pointer"
                        onClick={(data: any) => {
                          const count = data[key] as number
                          if (!count) return
                          openDrill(
                            `Ganadas: ${data.platform} · ${key}`,
                            opportunities.filter((o) => o.status === "won" && platformLabel(o) === data.platform && sourceCategory(o) === key)
                          )
                        }}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
              <ChartHint>Oportunidades ganadas · barras por plataforma de origen, apiladas por fuente de creación · haz clic en un segmento para ver los detalles</ChartHint>
            </>
          )}
        </ChartCardContent>
      </DashboardCard>
          </div>
      {/* Rendimiento por origen — single table, grouped by platform / Ad ID / URL */}
      <DashboardCard>
        <ChartCardHeader
          title="Rendimiento por origen"
          total={originRows.reduce((s, r) => s + r.wonCount, 0)}
          icon={BarChart3}
          actions={<OriginGroupByToggle value={originGroupBy} onChange={setOriginGroupBy} />}
        />
        <ChartCardContent>
          {originRows.length === 0 ? (
            <ChartEmpty message="Sin datos para este criterio." height={220} />
          ) : (
            <>
              <div className="overflow-auto max-h-[440px] rounded-md border border-border/40">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs">
                        {ORIGIN_GROUP_OPTIONS.find((o) => o.value === originGroupBy)!.column}
                      </TableHead>
                      <TableHead className="text-xs text-right">Leads</TableHead>
                      <TableHead className="text-xs text-right">Ganados</TableHead>
                      <TableHead className="text-xs text-right">% Cierre</TableHead>
                      <TableHead className="text-xs text-right">Valor</TableHead>
                      <TableHead className="text-xs text-right">Ticket prom.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {originRows.map((row) => (
                      <TableRow
                        key={row.key}
                        className="cursor-pointer"
                        onClick={() => openDrill(`Leads · ${row.label}`, row.opps)}
                      >
                        <TableCell className="text-xs font-medium text-foreground">
                          <span className="inline-flex items-center gap-1.5 max-w-[280px]">
                            {originGroupBy === "platform" && row.key === "Facebook" && (
                              <Facebook className="h-3.5 w-3.5 shrink-0 text-[#1877f2]" />
                            )}
                            {originGroupBy === "platform" && row.key === "Instagram" && (
                              <Instagram className="h-3.5 w-3.5 shrink-0 text-[#e1306c]" />
                            )}
                            <span className="truncate">{row.label}</span>
                            {originGroupBy !== "platform" && <CopyButton value={row.key} />}
                            {originGroupBy === "url" && <LinkButton value={row.key} />}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{row.total}</TableCell>
                        <TableCell className="text-right text-sm font-semibold tabular-nums text-foreground">{row.wonCount}</TableCell>
                        <TableCell
                          className={`text-right text-xs font-semibold tabular-nums ${
                            row.closeRate >= 20 ? "text-emerald-600" : row.closeRate >= 10 ? "text-amber-600" : "text-muted-foreground"
                          }`}
                        >
                          {row.closeRate.toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {row.wonValue > 0 ? `$${row.wonValue.toLocaleString("es-MX")}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {row.avgTicket > 0
                            ? `$${row.avgTicket.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ChartHint>
                {originGroupBy === "platform"
                  ? "Todas las oportunidades clasificadas por plataforma de origen · haz clic en una fila para ver sus leads"
                  : "Solo oportunidades con pauta · haz clic en una fila para ver sus leads"}
              </ChartHint>
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
